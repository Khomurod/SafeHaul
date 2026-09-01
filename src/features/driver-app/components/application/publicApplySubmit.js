// The guest application's submission path, split out of
// `PublicApplyHandler.jsx` on 2026-09-01 for the source-size standard
// (PA-1a). One React-free function, body verbatim from the component:
// pre-flight validation (unpersisted fields, required uploads, signature,
// email/phone), the E2E queue path, the queue-first guaranteed delivery, the
// three-attempt Cloud Function submission with backoff, and every discard
// re-check in between. This tab's refs are passed as the ref OBJECTS so the
// mutation semantics — capture before an await, re-read after it — are
// exactly the component's. `submittedDraftIdentity` moved with it because
// nothing else reads it.
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import * as Sentry from '@sentry/react';
import { resolveWizardStepIndex } from '@shared/components/layout/Stepper';
import { newSubmissionAttemptId } from '@shared/utils/submissionAttemptId';
import { isValidEmail, isValidPhone } from '@shared/utils/validation';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import {
  initQueue,
  enqueueSubmission,
  dequeueSubmission,
  isSupported as isQueueSupported
} from '@lib/submissionQueue';
import {
  generateApplicationId,
  generateConfirmationNumber
} from '@lib/applicationId';
import { SANDBOX_APP_SLUG } from '@features/sandbox/sandboxConstants';
import { hasUploadedFile } from './publicApplyHelpers';
import { clearApplicationDraft } from './applicationDraftStorage';
import { savePostApplySession } from './postApplyDocsStorage';
import { getMissingRequiredUnpersistedFields } from './requiredUnpersistedFields';

export async function submitPublicApplication({
  // State values as they stood when the applicant pressed Submit.
  formData,
  company,
  slug,
  sandbox,
  customQuestions,
  consentStepIndex,
  submissionStatus,
  cdlUploadConfig,
  medCardConfig,
  mvrConsentConfig,
  searchParams,
  // This tab's refs — the objects themselves, never their current values.
  discardMarkRef,
  resetGenerationRef,
  draftIdRef,
  isSubmittingRef,
  // The discard machinery and the draft's lifecycle closer.
  discardedElsewhere,
  handleDiscardedElsewhere,
  finishDraftLifecycle,
  // Setters and toasts.
  setCurrentStep,
  setSubmissionStatus,
  setSubmittedApplicationId,
  setSubmittedConfirmationNumber,
  setPostSubmitDocs,
  setSandboxSubmission,
  showError,
  showSuccess,
}) {
  /**
   * Which application a queued submission was made from.
   *
   * The queue entry can outlive this tab and land days later, by which time the apply
   * page may hold a different application entirely — so the slug alone is not enough
   * to decide whose draft to close. The draft's own opaque name answers it, and it has
   * to be the one this tab was working with: a counter restarts from zero on every new
   * draft, and the shared resume token can already name another tab's application by
   * the time the submission lands.
   */
  const submittedDraftIdentity = (markAtSubmit) => ({
    applySlug: slug,
    // What this page's discard mark said when the applicant pressed Submit — passed in,
    // not read here. A discard arriving during the work in between is exempted while a
    // submission is in flight, and exempting it adopts the new mark; recording *that*
    // would hand the entry a baseline equal to the discard itself, so a replay would
    // find nothing changed and send the discarded answers. The abort dequeues the entry,
    // but a dequeue can fail, and this is what makes that failure harmless.
    //
    // The replay compares it before sending: an application discarded while the entry
    // waited must not be submitted hours later, and this tab cannot be relied on to
    // cancel the entry itself — it may be a `queued` screen that a discard deliberately
    // leaves alone, or closed altogether.
    applyDiscardMark: markAtSubmit === undefined ? discardMarkRef.current : markAtSubmit,
    // This tab's own record, and *only* that. Falling back to a read of storage would
    // be the same mistake in a quieter place: if this tab's writes failed on quota
    // while another tab stored a draft for the same page, the read would hand this
    // submission the other tab's name and let it close their unsent work. Null when
    // this tab never took on a stored draft, which the close treats as "act only if
    // storage holds no draft either".
    applyDraftId: draftIdRef.current || null,
  });

    // Discarded elsewhere, and the most consequential place to miss it. A submission
    // is irreversible: it writes an application and freezes an immutable snapshot, so
    // letting discarded answers through here would make permanent exactly what the
    // applicant asked to be rid of. The `storage` event may not have arrived — a
    // suspended tab, or a discard between the last navigation and this click — so the
    // comparison runs here too, before any of the validation below.
    if (discardedElsewhere()) {
      handleDiscardedElsewhere();
      return;
    }
    // Captured here because the mark alone cannot be trusted for the rest of this
    // function. A `storage` event arriving during the work below is *exempted* while a
    // submission is in flight — the reaction must not wipe one that has landed — and
    // that exemption adopts the new mark, which makes a later comparison read clean.
    // The counter is bumped before the exemption, so it still remembers.
    const submitGeneration = resetGenerationRef.current;
    // The mark as it stands *now*, for the same reason. See `submittedDraftIdentity`.
    const submitMark = discardMarkRef.current;

    /**
     * Required answers a resumed application could not have brought back.
     *
     * Checked before the uploads, because it routes to an earlier page: a draft
     * never stores `ssn`, so an applicant who resumed part-way through has never
     * been asked for it and the step that collects it never ran its validation.
     * Sending them to the upload step first, then to page one, would be two
     * round trips for one incomplete form.
     *
     * The server refuses the same submission independently
     * (`assertRequiredUnpersistedFields`) — this half exists to tell the
     * applicant which field and take them to it, not to be the enforcement.
     */
    const missingUnpersisted = getMissingRequiredUnpersistedFields(
      company?.applicationConfig,
      formData,
    );
    if (missingUnpersisted.length > 0) {
      const labels = missingUnpersisted.map((field) => field.label).join(', ');
      const subject = missingUnpersisted.length > 1 ? 'They are' : 'It is';
      showError(`Please re-enter your ${labels} to submit. ${subject} not saved with your progress for security.`);
      setCurrentStep(resolveWizardStepIndex(
        missingUnpersisted[0].semanticStep,
        customQuestions.length > 0,
      ));
      return;
    }

    const requiredUploadErrors = [];
    if (!cdlUploadConfig.hidden && cdlUploadConfig.required) {
      if (!hasUploadedFile(formData['cdl-front'])) requiredUploadErrors.push('CDL Front');
      if (!hasUploadedFile(formData['cdl-back'])) requiredUploadErrors.push('CDL Back');
    }
    if (!medCardConfig.hidden && medCardConfig.required && !hasUploadedFile(formData['medical-card-upload'])) {
      requiredUploadErrors.push('Medical Card');
    }
    if (!mvrConsentConfig.hidden && mvrConsentConfig.required && !hasUploadedFile(formData['mvr-consent-upload'])) {
      requiredUploadErrors.push('MVR Consent Form');
    }
    if (requiredUploadErrors.length > 0) {
      showError(`Please upload required documents before submitting: ${requiredUploadErrors.join(', ')}.`);
      setCurrentStep(2);
      return;
    }

    // Validate signature and certification
    if (!formData.signature || !formData['final-certification']) {
      showError("Please complete the electronic signature.");
      setCurrentStep(consentStepIndex);
      return;
    }

    // Validate email and phone
    if (!isValidEmail(formData.email)) {
      showError("Invalid Email Address.");
      return;
    }
    if (!isValidPhone(formData.phone)) {
      showError("Invalid Phone Number.");
      return;
    }

    if (isSubmittingRef.current || submissionStatus === 'submitting') return;
    isSubmittingRef.current = true;
    setSubmissionStatus('submitting');

    // One id for this press of Submit, reused by all three retries below AND by
    // any later replay out of the offline queue. The server keys the preserved
    // submission record on it, so a call that timed out after the write
    // committed comes back as the SAME submission instead of a resubmission the
    // driver never made.
    const submissionAttemptId = newSubmissionAttemptId();

    if (isE2ETestMode && !sandbox) {
      // Deterministic offline-queue path for E2E: "all direct submits failed but
      // the submission is safely queued". The submission is written through the
      // real IndexedDB queue so the test verifies actual queue behavior — the
      // queued screen only renders if the enqueue genuinely succeeded.
      if (getE2EQueryParam('e2eForceQueue', '') === '1') {
        try {
          if (!isQueueSupported()) {
            throw new Error('Submission queue is not supported in this browser.');
          }
          await initQueue();
          await enqueueSubmission(
            { ...formData, companyId: company.id, sourceSlug: slug },
            company.id,
            // The apply slug travels with the entry so that, whenever this
            // submission finally lands, the queue can end the draft's local life
            // exactly as a direct submission does — and the draft's identity with
            // it, so a late replay closes this application and not a newer one.
            { type: 'guest', userId: null, ...submittedDraftIdentity(submitMark) },
          );
          clearApplicationDraft(slug);
          sessionStorage.removeItem('pending_application_recruiter');
          setSubmissionStatus('queued');
          showSuccess('Application saved! It will be submitted automatically when connection is restored.');
        } catch (queueError) {
          console.error('[PublicApplyHandler] E2E force-queue enqueue failed:', queueError);
          setSubmissionStatus('error');
          showError('Failed to submit application. Please try again.');
        } finally {
          isSubmittingRef.current = false;
        }
        return;
      }
      const confirmationNumber = generateConfirmationNumber();
      sessionStorage.setItem('lastConfirmationNumber', confirmationNumber);
      setSubmittedConfirmationNumber(confirmationNumber);
      setSubmittedApplicationId('e2e-application-id');
      setPostSubmitDocs({});
      savePostApplySession(company.id, {
        applicationId: 'e2e-application-id',
        confirmationNumber,
        slug,
        docs: {},
      });
      // `finishDraftLifecycle` owns the clear as well as the mark and the token: it
      // clears the draft *this* application was written from, and leaves another
      // tab's application alone if that is what occupies the slot.
      finishDraftLifecycle();
      sessionStorage.removeItem('pending_application_recruiter');
      setSubmissionStatus('success');
      return;
    }

    const email = formData.email || '';
    const phone = formData.phone || '';

    // Sentry breadcrumb
    Sentry.addBreadcrumb({
      category: 'submission',
      message: sandbox ? 'Sandbox guest application submission started' : 'Guest application submission started',
      data: { companyId: company.id, slug },
      level: 'info',
    });

    try {
      // 1. Generate deterministic application ID
      let applicationId;
      try {
        applicationId = await generateApplicationId(company.id, email, phone);
      } catch (idError) {
        // Fallback for ID generation failure
        const prefillLeadId = searchParams.get('prefill') || searchParams.get('leadId');
        applicationId = prefillLeadId || `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }

      // 2. Generate confirmation number
      const confirmationNumber = generateConfirmationNumber();


      const recruiterCode = sessionStorage.getItem('pending_application_recruiter');

      // Note: No client-side sanitizeData() needed here — httpsCallable handles JSON serialization,
      // and the Cloud Function (submitGuestApplication) does its own sanitization server-side.
      // AF6 FIX: Removed redundant `personalInfo` wrapper — all fields are spread from formData
      // at the top level, matching the authenticated submission structure exactly.
      const applicationData = {
        applicantId: applicationId,
        applicationId: applicationId,
        submissionAttemptId,
        confirmationNumber: confirmationNumber,
        ...formData,
        // Ensure these top-level keys always exist (overrides from formData if present)
        firstName: formData.firstName || '',
        lastName: formData.lastName || '',
        email: email,
        phone: phone,
        signature: formData.signature,
        signatureType: formData.signatureType || 'drawn',
        companyId: company.id,
        companyName: company.companyName,
        recruiterCode: recruiterCode || null,
        sourceType: sandbox ? 'Sandbox Application' : 'Public Application',
        sourceSlug: sandbox ? SANDBOX_APP_SLUG : slug,
        status: 'New Application',
        // BUGFIX: Removed submittedAt/createdAt serverTimestamp() from here.
        // sanitizeData() destroys FieldValue sentinels by recursing into them.
        // The Cloud Function (submitGuestApplication) adds server timestamps after sanitization.
        employers: Array.isArray(formData.employers) ? formData.employers : [],
        violations: Array.isArray(formData.violations) ? formData.violations : [],
        accidents: Array.isArray(formData.accidents) ? formData.accidents : [],
        schools: Array.isArray(formData.schools) ? formData.schools : [],
        military: Array.isArray(formData.military) ? formData.military : [],
        // Bulletproof tracking
        lifecycle: {
          status: 'pending',
          submittedAt: new Date().toISOString(),
          clientVersion: sandbox ? 'sandbox' : '2.0-bulletproof',
          isGuest: true,
        },
      };

      // 3. Queue first for guaranteed delivery
      let queueId = null;
      /**
       * Gives up on this submission because the application was discarded.
       *
       * The queue entry goes first. It was written before the attempts for guaranteed
       * delivery, and leaving it would replay the discarded answers hours later — the
       * very hole the replay guard exists to plug, and this is the belt to its braces.
       * Then the submitting state is cleared *before* reacting, because the reaction
       * deliberately leaves a submission in flight alone, and this one is being
       * abandoned rather than landed.
       */
      const abandonForDiscard = async () => {
        if (queueId) {
          try {
            await dequeueSubmission(queueId);
          } catch (dequeueError) {
            console.warn('[PublicApplyHandler] Dequeue after a discard failed:', dequeueError);
          }
        }
        setSubmissionStatus(null);
        isSubmittingRef.current = false;
        handleDiscardedElsewhere();
      };

      if (isQueueSupported()) {
        try {
          await initQueue();
          queueId = await enqueueSubmission(applicationData, company.id, {
            type: 'guest',
            userId: null,
            // Carried so a replay that succeeds hours later can close this draft's
            // local life — write the mark other tabs read, drop the token, clear the
            // copy. Without it a queued submission that lands leaves every other open
            // tab believing the application is still unfinished, free to submit these
            // answers a second time. The identity comes too, because by then the
            // applicant may have started a different application on the same page.
            ...submittedDraftIdentity(submitMark),
          });
          console.log(`[PublicApplyHandler] Queued submission ${queueId}`);
        } catch (queueError) {
          console.warn('[PublicApplyHandler] Queue failed:', queueError);
        }
      }

      // 4. Submit via Cloud Function (Admin SDK — bypasses all rules)
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        // The guard at the top of this function is not enough on its own. Between it
        // and here are an id generation, a queue write and, on a retry, a backoff wait
        // — seconds in which another tab can discard. Both questions are asked,
        // because they catch different deliveries: the mark comparison sees a discard
        // no event announced, and the generation sees one that *did* arrive as an event
        // and was exempted, which adopted the mark and left the comparison clean.
        if (discardedElsewhere() || resetGenerationRef.current !== submitGeneration) {
          await abandonForDiscard();
          return;
        }
        try {
          const submitFn = httpsCallable(functions, 'submitGuestApplication');
          const result = await submitFn({
            companyId: company.id,
            email: email,
            phone: phone,
            signature: formData.signature,
            formData: applicationData,
          });

          // Use server-generated values if available
          const serverData = result.data || {};

          // Success - dequeue if queued
          if (queueId) {
            try {
              await dequeueSubmission(queueId);
            } catch (dequeueError) {
              console.warn('[PublicApplyHandler] Dequeue failed:', dequeueError);
            }
          }

          // Scoped clear, mark and token together — see `finishDraftLifecycle`.
          finishDraftLifecycle();
          sessionStorage.removeItem('pending_application_recruiter');

          Sentry.addBreadcrumb({
            category: 'submission',
            message: sandbox
              ? 'Sandbox guest application submitted successfully via Cloud Function'
              : 'Guest application submitted successfully via Cloud Function',
            data: { applicationId: serverData.applicationId || applicationId, confirmationNumber: serverData.confirmationNumber || confirmationNumber },
            level: 'info',
          });

          const finalConfirm = serverData.confirmationNumber || confirmationNumber;
          const finalApplicationId = serverData.applicationId || applicationId;
          sessionStorage.setItem('lastConfirmationNumber', finalConfirm);
          setSubmittedApplicationId(finalApplicationId);
          setSubmittedConfirmationNumber(finalConfirm);

          if (!sandbox) {
            // Seed the required-documents session so the checklist survives
            // the navigation round trip through the signing room.
            setPostSubmitDocs({});
            savePostApplySession(company.id, {
              applicationId: finalApplicationId,
              confirmationNumber: finalConfirm,
              slug,
              docs: {},
            });
          }

          if (sandbox) {
            setSandboxSubmission({
              applicationId: serverData.applicationId || applicationId,
              confirmationNumber: finalConfirm,
            });
            setSubmissionStatus(null);
            showSuccess('Sandbox application saved.');
          } else {
            setSubmissionStatus('success');
          }
          return; // Exit on success

        } catch (error) {
          console.warn(`[PublicApplyHandler] Attempt ${attempt} failed:`, error);
          lastError = error;
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
          }
        }
      }

      // All attempts failed
      Sentry.captureException(lastError, {
        tags: { flow: 'guest_application', stage: 'submission_failed' },
        extra: { applicationId, companyId: company.id, queueId },
      });

      // Discarded while the last attempt was still out. Without this the applicant is
      // shown "saved, and it will be submitted when the connection returns" for a
      // submission the replay guard will correctly refuse to send — they would wait for
      // something that is never going to happen.
      if (discardedElsewhere() || resetGenerationRef.current !== submitGeneration) {
        await abandonForDiscard();
        return;
      }

      // If queued, show partial success
      if (queueId) {
        setSubmissionStatus('queued');
        showSuccess("Your application is saved and will be submitted automatically when connection is restored.");
      } else {
        throw lastError;
      }

    } catch (error) {
      console.error("Submission error:", error);
      setSubmissionStatus('error');
      showError("Failed to submit application. Please try again.");
    } finally {
      isSubmittingRef.current = false;
    }
}
