// src/features/driver-app/components/application/PublicApplyHandler.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import Stepper, { resolveWizardStepIndex } from '@shared/components/layout/Stepper';
import { IntakeChooser } from './IntakeChooser';
import { newSubmissionAttemptId } from '@shared/utils/submissionAttemptId';
import {
  getFieldConfig,
  hasUploadedFile,
  normalizePostApplicationTemplates,
  buildE2EPublicProfile,
  buildPostApplyDocErrorMessage,
} from './publicApplyHelpers';
import {
  readApplicationDraft,
  saveApplicationDraft,
  clearApplicationDraft,
  draftSyncState,
  sameDraftData,
} from './applicationDraftStorage';
import { fetchPublicProfileBySlug } from '../../services/publicProfileService';
import { useGuestFileUpload } from '../../hooks/useGuestFileUpload';
import { useCdlAutoFill } from '../../hooks/useCdlAutoFill';
import {
  DOC_STATUS,
  savePostApplySession,
  readPostApplySession,
  clearPostApplySession,
  markRequestSigned,
  isRequestSigned,
  setSigningReturnPath,
} from './postApplyDocsStorage';
import {
  ApplyLoadingScreen,
  ApplyLinkErrorScreen,
  ParsingCdlScreen,
  SubmissionSuccessScreen,
  SubmissionQueuedScreen,
} from './PublicApplyScreens';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { useData } from '@/context/DataContext';
import { isValidEmail, isValidPhone } from '@shared/utils/validation';
import * as Sentry from '@sentry/react';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { useApplicationResume } from '../../hooks/useApplicationResume';
import { ResumeApplicationDialog } from './ResumeApplicationDialog';
import { reconcileApplicationDraft } from './reconcileApplicationDraft';
import { getMissingRequiredUnpersistedFields } from './requiredUnpersistedFields';

// Bulletproof submission imports
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
import { Card } from '@/design-system/components';
import { getMagicFillPatchForStep } from '@features/sandbox/utils/dummyDataGenerator';
import { SandboxActionPanel } from '@features/sandbox/SandboxActionPanel';
import {
  SANDBOX_APP_SLUG,
  SANDBOX_COMPANY_ID,
  buildDefaultSandboxPublicProfile,
} from '@features/sandbox/sandboxConstants';

/**
 * Guest application (public link). Pass `sandbox` so `/sandbox/apply` reuses this file verbatim —
 * same Stepper, steps, submission queue, and employment/FMCSA behavior as production guest apply.
 */
export function PublicApplyHandler({ sandbox = false } = {}) {
  const params = useParams();
  const slug = sandbox ? SANDBOX_APP_SLUG : params.slug;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo } = useToast();
  const { setCurrentCompanyProfile } = useData();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [company, setCompany] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({});
  const [intakeMode, setIntakeMode] = useState(null); // null | manual
  const [submissionStatus, setSubmissionStatus] = useState(null);
  const [submittedApplicationId, setSubmittedApplicationId] = useState('');
  const [submittedConfirmationNumber, setSubmittedConfirmationNumber] = useState('');
  const [openingTemplateId, setOpeningTemplateId] = useState('');
  // Per-template progress for the post-submission Required Documents checklist:
  // { [templateId]: { status: DOC_STATUS.*, requestId?: string, error?: string } }
  const [postSubmitDocs, setPostSubmitDocs] = useState({});
  const [sandboxSubmission, setSandboxSubmission] = useState(null);
  const hasStarted = useRef(false);
  const isSubmittingRef = useRef(false);

  const { isUploading, handleFileUpload } = useGuestFileUpload(company?.id);
  const {
    isParsingCdl,
    autoFillStoragePath,
    cdlInputRef: cdlAutoFillInputRef,
    handleChooseAutoFill,
    handleCdlFileChange: handleCdlAutoFillFileChange,
  } = useCdlAutoFill({
    companyId: company?.id,
    onAutoFilled: (updater) => {
      setFormData(updater);
      setCurrentStep(0);
      setIntakeMode('manual');
    },
    onReturnToChooser: () => setIntakeMode(null),
  });

  // #7 FIX: Derive custom questions from company profile for public applicants.
  // Memoized because it is a hook dependency: a fresh `[]` on every render would
  // re-create the callbacks that depend on it, and one of those drives the
  // resume flow.
  const customQuestions = useMemo(() => company?.customQuestions || [], [company]);
  const postApplicationTemplates = normalizePostApplicationTemplates(company?.postApplicationTemplates);
  // #8 FIX: Dynamic consent step index based on whether custom questions exist
  const consentStepIndex = customQuestions.length > 0 ? 9 : 8;
  /**
   * Server-side autosave and the "continue your existing application?" flow.
   *
   * Sandbox is excluded: a sandbox application is a disposable demo and there is
   * nothing to come back to.
   */
  const {
    resumePrompt,
    resumeBusy,
    resumeError,
    saveProgressToServer: saveDraftToServer,
    restoreFromStoredToken,
    continueExisting,
    startOver,
  } = useApplicationResume({
    slug,
    companyId: company?.id,
    sandbox,
    hasCustomQuestions: customQuestions.length > 0,
  });

  const cdlUploadConfig = getFieldConfig(company?.applicationConfig, 'cdlUpload');
  const medCardConfig = getFieldConfig(company?.applicationConfig, 'medCardUpload');
  const mvrConsentConfig = getFieldConfig(company?.applicationConfig, 'mvrConsent');

  /**
   * Restore a recent submission (and its document checklist) after the driver
   * navigated to the signing room and came back — the round trip unmounts this
   * component, so React state alone cannot carry the checklist across.
   * Completion markers written by SigningRoom are merged in here.
   */
  const restorePostApplySession = useCallback((companyData) => {
    if (!companyData?.id) return false;
    const session = readPostApplySession(companyData.id);
    if (!session) return false;
    if (session.slug && slug && session.slug !== slug) return false;

    const mergedDocs = {};
    for (const [templateId, docState] of Object.entries(session.docs || {})) {
      if (!docState) continue;
      if (docState.requestId && isRequestSigned(companyData.id, docState.requestId)) {
        mergedDocs[templateId] = { ...docState, status: DOC_STATUS.COMPLETED, error: null };
      } else if (docState.status === DOC_STATUS.OPENING) {
        // Navigation away was interrupted — allow re-opening.
        mergedDocs[templateId] = { ...docState, status: DOC_STATUS.NOT_STARTED };
      } else {
        mergedDocs[templateId] = docState;
      }
    }

    setPostSubmitDocs(mergedDocs);
    setSubmittedApplicationId(session.applicationId);
    setSubmittedConfirmationNumber(session.confirmationNumber || '');
    if (session.confirmationNumber) {
      sessionStorage.setItem('lastConfirmationNumber', session.confirmationNumber);
    }
    setSubmissionStatus('success');
    savePostApplySession(companyData.id, { ...session, docs: mergedDocs });
    return true;
  }, [slug]);

  // 1. Load Company Info from Slug (or fixed SANDBOX public profile when `sandbox`)
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    async function loadCompany() {
      if (!sandbox && !slug) {
        setError("Invalid link - no company specified.");
        setLoading(false);
        return;
      }

      try {
        if (sandbox) {
          const snap = await getDoc(doc(db, 'public_profiles', SANDBOX_COMPANY_ID));
          const companyData = snap.exists()
            ? { id: SANDBOX_COMPANY_ID, ...snap.data() }
            : buildDefaultSandboxPublicProfile();
          setCompany(companyData);
          if (setCurrentCompanyProfile) {
            setCurrentCompanyProfile(companyData);
          }
          const sandboxDraft = readApplicationDraft(slug);
          if (sandboxDraft) {
            setFormData((prev) => ({ ...prev, ...sandboxDraft.data }));
          }
          const recruiter = searchParams.get('r') || searchParams.get('recruiter');
          if (recruiter) {
            sessionStorage.setItem('pending_application_recruiter', recruiter);
          }
          sessionStorage.setItem('pending_application_company', SANDBOX_COMPANY_ID);
          setIntakeMode('manual');
          setLoading(false);
          return;
        }

        if (isE2ETestMode) {
          const mockCompany = buildE2EPublicProfile(slug);
          setCompany(mockCompany);
          if (setCurrentCompanyProfile) {
            setCurrentCompanyProfile(mockCompany);
          }
          sessionStorage.setItem('pending_application_company', mockCompany.id);
          restorePostApplySession(mockCompany);
          if (getE2EQueryParam('e2eIntake', 'manual') !== 'choice') {
            setIntakeMode('manual');
          }
          const e2eDraft = readApplicationDraft(slug);
          if (e2eDraft) {
            setFormData((prev) => ({ ...prev, ...e2eDraft.data }));
            if (typeof e2eDraft.lastStep === 'number') {
              setCurrentStep(e2eDraft.lastStep);
            }
          }
          setLoading(false);
          return;
        }

        const companyData = await fetchPublicProfileBySlug(slug);

        if (!companyData) {
          setError("Company not found.");
          setLoading(false);
          return;
        }

        setCompany(companyData);
        // Important: Global context setter preserved
        if (setCurrentCompanyProfile) {
          setCurrentCompanyProfile(companyData);
        }

        // Returning from the signing room (or a reload right after submitting):
        // bring back the success screen + required-documents checklist.
        restorePostApplySession(companyData);

        // P2-5 FIX: Recover saved draft from localStorage on page revisit.
        //
        // The step is honoured as well as the fields. Restoring the answers and
        // then showing page one meant a returning applicant had to click Next
        // eight times past forms that were already filled in, which reads as
        // "nothing was saved".
        const savedDraft = readApplicationDraft(slug);
        if (savedDraft) {
          setFormData(prev => ({ ...prev, ...savedDraft.data }));
          if (typeof savedDraft.lastStep === 'number') {
            setCurrentStep(savedDraft.lastStep);
            setIntakeMode('manual');
          }
        }

        const recruiter = searchParams.get('r') || searchParams.get('recruiter');
        if (recruiter) {
          sessionStorage.setItem('pending_application_recruiter', recruiter);
        }

        sessionStorage.setItem('pending_application_company', companyData.id);
        setLoading(false);

      } catch (err) {
        console.error("Error loading company:", err);
        setError("Unable to load application.");
        setLoading(false);
      }
    }
    loadCompany();
  }, [slug, sandbox, searchParams, setCurrentCompanyProfile, restorePostApplySession]);

  /**
   * Latest form state, read by things that run later than the render they belong
   * to — the reconciliation callback and the reconnect listener. Declared above
   * both, so neither depends on where the other happens to sit in the file.
   */
  const latestDraftRef = useRef({ formData, currentStep });
  latestDraftRef.current = { formData, currentStep };

  /**
   * Reconciles with the server copy once the company is known.
   *
   * Its own effect on purpose. Calling this inside the company-loading effect
   * looked equivalent and was not: the resume hook is constructed with
   * `companyId: company?.id`, and that id is only set *by* that effect — so the
   * closure captured `undefined`, the hook reported itself disabled, and the
   * server restore silently never ran. Keyed on the id it actually needs.
   *
   * The local copy is normally the same or newer, so this matters in two cases:
   * storage was partially cleared and the token outlived the draft, or the draft
   * was discarded or has expired server-side — in which case the hook drops the
   * stale token rather than retrying it on every load.
   */
  useEffect(() => {
    if (!company?.id || sandbox) return;
    let current = true;
    restoreFromStoredToken().then((restored) => {
      if (!current || !restored) return;
      // This used to be `{ ...prev, ...restored.formData }`, which made the server
      // copy win every field it held whether or not it was the newer one. That
      // destroyed the local backup with the very failure it exists to survive: a
      // save fails, the driver refreshes, and the older server values come back
      // over their edits with nothing said.
      //
      // The local copy is re-read here rather than relied upon through `prev`, so
      // the decision does not depend on the order two effects happen to run in.
      // Read outside the updater: a `setFormData` updater has to stay pure,
      // because React may invoke it more than once.
      // All of this outside the updater: a `setFormData` updater has to stay pure,
      // because React may invoke it more than once, and one of the steps below
      // writes to storage.
      const resolved = reconcileApplicationDraft({
        local: readApplicationDraft(slug),
        server: restored,
        live: latestDraftRef.current.formData,
      });
      if (!resolved) return;

      // Write the outcome back locally when the **server** copy won.
      //
      // Otherwise the next navigation would write that server content out as if it
      // were unacknowledged local work: the copy would read as dirty, and a further
      // advance from a third device would then lose to content that came from the
      // server in the first place. Same reasoning as the explicit Continue path in
      // `applyRestoredDraft`.
      //
      // When *local* won the sequences are deliberately left alone — that copy
      // really does hold work the server has not seen, and is still owed a save.
      if (resolved.source === 'server') {
        // Synced only if the merged body really is the server's body. The reconciler
        // overlays anything typed since page load, and the server fetch is a round
        // trip an applicant can type through — so marking the whole merged body
        // synced would claim the server holds an edit it has never seen. Close the
        // tab there and the next load, finding a clean local copy, would hand back
        // the older server value: the silent loss this mechanism exists to prevent,
        // through a two-second window.
        //
        // Keys only the local copy has count the same way, for the same reason.
        const serverSeq = Number.isInteger(restored.clientSeq) ? restored.clientSeq : null;
        const holdsMoreThanServer = !sameDraftData(resolved.formData, restored.formData);
        saveApplicationDraft(slug, resolved.formData, holdsMoreThanServer
          // One above the server's position, with the synced position left at it:
          // dirty, so the next navigation or reconnect sends it, while a later
          // genuine server advance is still recognised by `clientSeq !== syncedSeq`.
          ? {
            lastStep: resolved.stepIndex,
            localSeq: (serverSeq ?? 0) + 1,
            syncedSeq: serverSeq ?? 0,
          }
          : {
            lastStep: resolved.stepIndex,
            localSeq: serverSeq ?? undefined,
            synced: true,
          });
      }

      // `resolved.formData` already carries anything typed since load, so it goes
      // last; `prev` still supplies the wizard's untouched defaults.
      setFormData((prev) => ({ ...prev, ...resolved.formData }));
      // `Math.max`: never move an applicant *backwards* from where they already
      // are in this session.
      setCurrentStep((prev) => Math.max(prev, restored.stepIndex));
      setIntakeMode('manual');
    }).catch(() => {
      // Handled inside the hook. Nothing here may interrupt the apply page.
    });
    return () => { current = false; };
  }, [company?.id, sandbox, slug, restoreFromStoredToken]);

  /**
   * Retries the server copy when the connection comes back.
   *
   * Without this, the only triggers for a server save are Next and "Save as
   * Draft" — so an applicant who lost signal, typed a page, and regained signal
   * while sitting on that page kept their work locally and never sent it. Nothing
   * was lost (the submission carries the full form), but the server draft stayed
   * behind, which is the copy a recruiter sees and the one that survives a lost
   * device.
   *
   * Only when the local copy is actually owed a save. A clean draft needs no
   * round trip, and a legacy draft counts as owed because nothing is known about
   * whether the server has its contents.
   */
  useEffect(() => {
    if (!slug || sandbox || !company?.id) return undefined;
    const flush = () => {
      const state = draftSyncState(slug);
      if (!state?.dirty) return;
      const { formData: latest, currentStep: step } = latestDraftRef.current;
      saveDraftToServer({ formData: latest, stepIndex: step, localSeq: state.localSeq });
    };
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [slug, sandbox, company?.id, saveDraftToServer]);

  // 2. Form Handlers
  const handleUpdateFormData = (name, value) => {
    setFormData((prev) => ({
      ...prev,
      [name]: typeof value === 'function' ? value(prev[name]) : value,
    }));
  };

  /**
   * The local copy, written synchronously on every step change.
   *
   * First, and synchronously, on purpose: it cannot fail for a network reason and
   * it cannot delay the applicant. The server copy follows in the background,
   * so a driver on a bad connection still has everything they typed when they
   * come back to this browser — which is the case this whole feature exists for.
   *
   * This used to be gated behind the E2E test flag, so in production nothing was
   * written per step at all and `lastStep` was never recorded. Three lines, and
   * `e2e/guest-draft-resume.spec.cjs` had been proving the mechanism worked the
   * whole time.
   */
  const persistLocalDraft = useCallback((stepIndex) => {
    if (!slug || sandbox) return null;
    // The returned sequence identifies exactly this write. It travels with the
    // server save so that, when the save lands, only *this* content is marked
    // synced — see `markDraftSynced`.
    const { localSeq } = saveApplicationDraft(slug, formData, { lastStep: stepIndex });
    return localSeq;
  }, [slug, sandbox, formData]);

  const handleNavigate = (direction) => {
    let nextStep = currentStep;
    if (direction === 'next') nextStep = currentStep + 1;
    else if (direction === 'back') nextStep = Math.max(0, currentStep - 1);
    else if (typeof direction === 'number') nextStep = direction;

    setCurrentStep(nextStep);
    const localSeq = persistLocalDraft(nextStep);
    // Only forward: going back is not new information, and a save on every Back
    // click would spend the applicant's rate-limit budget on nothing.
    //
    // One call, not two. The hook runs the resume lookup itself before its first
    // server write and holds the write until the applicant has answered the
    // prompt — see its header for the three ways a save racing that lookup loses
    // the draft it was supposed to protect.
    if (direction === 'next') {
      saveDraftToServer({ formData, stepIndex: nextStep, localSeq });
    }
    // Scrolling is owned by `Stepper`, which focuses the new step's heading.
    // A second scroll here raced that one and made step transitions
    // non-deterministic (see the Stepper header comment).
  };

  /**
   * Applies a restored draft to the wizard.
   *
   * Merged over whatever is already there rather than replacing it: an applicant
   * who typed a page before being recognised should not lose those keystrokes to
   * the restore, and the stored answers are the ones that matter for every field
   * they have not touched this session.
   */
  const applyRestoredDraft = useCallback((restored) => {
    if (!restored) return;
    setFormData((prev) => ({ ...prev, ...restored.formData }));
    setCurrentStep(restored.stepIndex);
    setIntakeMode('manual');
    // Written straight back to the local copy, so a reload after a restore does
    // not fall back to a staler draft than the one just loaded.
    //
    // Recorded as **already synced**: this copy *is* the server's copy. Letting it
    // advance the sequence as an ordinary write would mark it as holding
    // unacknowledged work, and the next page load would then prefer it over a
    // server draft that had genuinely moved on since.
    //
    // `synced: true` rather than a number, because a server draft written before
    // `clientSeq` existed has none to adopt — and it still must not be treated as
    // unsynced local work.
    saveApplicationDraft(slug, { ...formData, ...restored.formData }, {
      lastStep: restored.stepIndex,
      localSeq: Number.isInteger(restored.clientSeq) ? restored.clientSeq : undefined,
      synced: true,
    });
    showSuccess('Your saved application has been restored.');
  }, [slug, formData, showSuccess]);

  const handleContinueExisting = useCallback(async () => {
    applyRestoredDraft(await continueExisting());
  }, [continueExisting, applyRestoredDraft]);

  const handleStartOver = useCallback(async () => {
    if (!(await startOver())) return;
    // A genuinely new application: the local copy goes too, or the next reload
    // would restore what the applicant just asked to be rid of.
    clearApplicationDraft(slug);
    showInfo('Starting a new application.');
  }, [startOver, slug, showInfo]);

  const handleMagicFillStep = useCallback(() => {
    const patch = getMagicFillPatchForStep(currentStep, {
      hasCustomQuestions: customQuestions.length > 0,
    });
    setFormData((prev) => ({ ...prev, ...patch }));
  }, [currentStep, customQuestions]);

  const handleChooseManual = () => {
    setIntakeMode('manual');
  };

  const handlePartialSubmit = () => {
    // SEC-2/DL-1 live in applicationDraftStorage: ssn/signature are stripped and a
    // QuotaExceededError is surfaced (false) rather than silently swallowed.
    //
    // `lastStep` is recorded now. It was omitted, so an explicit "Save as Draft"
    // saved the answers and forgot where the applicant was — and the restore path
    // ignored the field anyway, so they landed back on page one either way.
    // `.ok`, not the return value itself: this used to be a bare boolean and is
    // now `{ ok, localSeq }`, so testing the object would make every quota
    // failure look like a success.
    const { ok, localSeq } = saveApplicationDraft(slug, formData, { lastStep: currentStep });
    if (ok) {
      saveDraftToServer({ formData, stepIndex: currentStep, localSeq });
      showSuccess("Progress saved.");
    } else {
      showError("Could not save progress locally. Your data is still here — please continue filling the form.");
    }
  };

  const handleFinalSubmit = async () => {
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
            { type: 'guest', userId: null },
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
      clearApplicationDraft(slug);
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
      if (isQueueSupported()) {
        try {
          await initQueue();
          queueId = await enqueueSubmission(applicationData, company.id, {
            type: 'guest',
            userId: null,
          });
          console.log(`[PublicApplyHandler] Queued submission ${queueId}`);
        } catch (queueError) {
          console.warn('[PublicApplyHandler] Queue failed:', queueError);
        }
      }

      // 4. Submit via Cloud Function (Admin SDK — bypasses all rules)
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
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

          clearApplicationDraft(slug);
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
  };

  /** Update one template's checklist state and persist the session snapshot. */
  const updatePostSubmitDoc = useCallback((templateId, patch) => {
    setPostSubmitDocs((prev) => {
      const next = { ...prev, [templateId]: { ...(prev[templateId] || {}), ...patch } };
      if (company?.id && submittedApplicationId && !sandbox) {
        savePostApplySession(company.id, {
          applicationId: submittedApplicationId,
          confirmationNumber:
            submittedConfirmationNumber || sessionStorage.getItem('lastConfirmationNumber') || '',
          slug,
          docs: next,
        });
      }
      return next;
    });
  }, [company?.id, submittedApplicationId, submittedConfirmationNumber, slug, sandbox]);

  const handleStartNewApplication = useCallback(() => {
    if (company?.id) clearPostApplySession(company.id);
    sessionStorage.removeItem('lastConfirmationNumber');
    setSubmissionStatus(null);
    setSubmittedApplicationId('');
    setSubmittedConfirmationNumber('');
    setPostSubmitDocs({});
    setFormData({});
    setCurrentStep(0);
  }, [company?.id]);

  const handleOpenPostApplicationTemplate = async (template) => {
    if (!template?.templateId || !company?.id || !submittedApplicationId) {
      showError('Could not open this form yet. Please refresh and try again.');
      return;
    }

    const confirmationNumber = submittedConfirmationNumber || sessionStorage.getItem('lastConfirmationNumber') || '';
    if (!confirmationNumber) {
      showError('Missing confirmation number. Please refresh and try again.');
      return;
    }

    // One document at a time; also guards rapid double-clicks (the backend is
    // additionally idempotent per application+template, so even a race cannot
    // create duplicate signing requests).
    if (openingTemplateId) return;

    const returnPath = sandbox ? '/sandbox/apply' : `/apply/${slug}`;

    try {
      setOpeningTemplateId(template.templateId);
      updatePostSubmitDoc(template.templateId, { status: DOC_STATUS.OPENING, error: null });

      if (isE2ETestMode) {
        const requestId = `e2e-post-app-req-${template.templateId}`;
        setSigningReturnPath(company.id, requestId, returnPath);
        updatePostSubmitDoc(template.templateId, { status: DOC_STATUS.IN_PROGRESS, requestId });
        navigate(`/sign/${company.id}/${requestId}?token=e2e-token&e2eSign=mock`);
        return;
      }

      const createSigningRequest = httpsCallable(functions, 'createPostApplicationSigningRequest', { timeout: 60000 });
      const { data } = await createSigningRequest({
        companyId: company.id,
        applicationId: submittedApplicationId,
        confirmationNumber,
        templateId: template.templateId,
        appBaseUrl: window.location.origin,
      });

      // Idempotent backend: an already-signed document reports completion
      // instead of minting a duplicate request.
      if (data?.alreadyCompleted && data?.requestId) {
        markRequestSigned(company.id, data.requestId);
        updatePostSubmitDoc(template.templateId, {
          status: DOC_STATUS.COMPLETED,
          requestId: data.requestId,
          error: null,
        });
        showSuccess('This document is already completed.');
        return;
      }

      if (!data?.requestId || !data?.accessToken) {
        throw new Error('Could not generate signing link.');
      }

      setSigningReturnPath(company.id, data.requestId, returnPath);
      updatePostSubmitDoc(template.templateId, {
        status: DOC_STATUS.IN_PROGRESS,
        requestId: data.requestId,
      });
      navigate(`/sign/${company.id}/${data.requestId}?token=${data.accessToken}`);
    } catch (error) {
      // Structured diagnostics (ids + code only — never tokens, SSNs, or signatures).
      console.error('[PublicApplyHandler] Post-application e-doc launch failed:', {
        code: error?.code || 'unknown',
        templateId: template.templateId,
        companyId: company.id,
        message: error?.message,
      });
      const friendly = buildPostApplyDocErrorMessage(error);
      updatePostSubmitDoc(template.templateId, { status: DOC_STATUS.ERROR, error: friendly });
      showError(friendly);
    } finally {
      setOpeningTemplateId('');
    }
  };

  if (loading) return <ApplyLoadingScreen />;

  if (error) return <ApplyLinkErrorScreen error={error} />;

  if (isParsingCdl) {
    return <ParsingCdlScreen autoFillStoragePath={autoFillStoragePath} />;
  }

  if (sandbox && sandboxSubmission) {
    return (
      <SandboxActionPanel
        applicationId={sandboxSubmission.applicationId}
        confirmationNumber={sandboxSubmission.confirmationNumber}
        onDeletedRestart={() => {
          setSandboxSubmission(null);
          setCurrentStep(0);
          setFormData({});
          sessionStorage.removeItem('lastConfirmationNumber');
        }}
      />
    );
  }

  // The success screen (with the required-documents checklist) must render
  // before the intake chooser: a restored post-submission session has no
  // intakeMode, and the driver must land back on their checklist, not on a
  // fresh application chooser.
  if (submissionStatus === 'success') {
    return (
      <SubmissionSuccessScreen
        postApplicationTemplates={postApplicationTemplates}
        submittedApplicationId={submittedApplicationId}
        docStates={postSubmitDocs}
        openingTemplateId={openingTemplateId}
        handleOpenPostApplicationTemplate={handleOpenPostApplicationTemplate}
        onGoHome={() => navigate('/')}
        onStartNewApplication={handleStartNewApplication}
        confirmationNumber={submittedConfirmationNumber}
      />
    );
  }

  if (!intakeMode) {
    return (
      <IntakeChooser
        companyName={company.companyName}
        onChooseAutoFill={handleChooseAutoFill}
        onChooseManual={handleChooseManual}
        cdlInputRef={cdlAutoFillInputRef}
        onCdlFileChange={handleCdlAutoFillFileChange}
      />
    );
  }

  // P3-3 FIX: Queued status UI — shown when all direct submit attempts failed but data is queued
  if (submissionStatus === 'queued') return <SubmissionQueuedScreen onGoHome={() => navigate('/')} />;

  return (
    <div className="min-h-screen bg-ds-canvas pb-ds-12">
      {/* The company banner is a `<header>` landmark so a screen-reader user can
          reach "whose application is this?" without walking the whole form. */}
      <header className="sticky top-0 z-20 border-b border-ds-border-subtle bg-ds-surface px-ds-4 py-ds-3 shadow-ds-xs">
        <div className="mx-auto flex max-w-4xl flex-col gap-ds-2">
          <p className="font-bold text-ds-content">{company.companyName}</p>
          {sandbox && (
            <p className="rounded-ds-lg border border-ds-status-warning-border bg-ds-status-warning-bg px-ds-3 py-ds-2 text-center text-ds-xs font-medium text-ds-status-warning-fg">
              Testing mode — applications are stored under tenant <strong>SANDBOX</strong>. Use Super Admin actions after submit to delete or transfer.
            </p>
          )}
        </div>
      </header>
      <Card as="main" padding="none" className="mx-auto mt-ds-6 max-w-4xl overflow-hidden">
        <Stepper
          step={currentStep}
          formData={formData}
          updateFormData={handleUpdateFormData}
          onNavigate={handleNavigate}
          onPartialSubmit={handlePartialSubmit}
          onFinalSubmit={handleFinalSubmit}
          handleFileUpload={handleFileUpload}
          isUploading={isUploading}
          submissionStatus={submissionStatus}
          customQuestions={customQuestions}
          isSandboxMode={sandbox}
          onMagicFillStep={sandbox ? handleMagicFillStep : undefined}
        />
      </Card>

      {/* Offered on the first forward move, once the identity a resume is
          matched on has been filled in. Rendering it here rather than at the
          intake chooser keeps the applicant's typed page one on screen behind
          it, so the question reads as "you have been here before" rather than
          as an interruption before they have done anything. */}
      <ResumeApplicationDialog
        prompt={resumePrompt}
        loading={resumeBusy}
        error={resumeError}
        onContinue={handleContinueExisting}
        onStartOver={handleStartOver}
      />
    </div>
  );
}
// END OF FILE
