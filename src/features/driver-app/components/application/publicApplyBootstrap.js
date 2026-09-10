// How the guest application page boots and stays reconciled, split out of
// `PublicApplyHandler.jsx` on 2026-09-01 for the source-size standard
// (PA-1b). Four React-free functions, bodies verbatim from the component:
// the post-apply session restore, the company load (sandbox / E2E /
// production, with the local-draft restore and its discard guards), the
// server-draft reconciliation (returning the effect's own cleanup), and the
// reconnect flush listener (likewise returning its cleanup). The component's
// effects keep their exact dependency arrays and pass this tab's refs as the
// ref OBJECTS, so capture/re-read semantics are unchanged.
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { fetchPublicProfileBySlug } from '../../services/publicProfileService';
import {
  SANDBOX_COMPANY_ID,
  buildDefaultSandboxPublicProfile,
} from '@features/sandbox/sandboxConstants';
import { buildE2EPublicProfile } from './publicApplyHelpers';
import { readApplicationDraft } from './applicationDraftStorage';
import {
  DOC_STATUS,
  savePostApplySession,
  readPostApplySession,
  isRequestSigned,
} from './postApplyDocsStorage';
import {
  INVITE_OUTCOMES, adoptOpenedApplication, openPreparedApplication,
  permissionsAfterInvite, retireStalePostApplySession,
} from './publicApplyInvite';

  /**
   * Restore a recent submission (and its document checklist) after the driver
   * navigated to the signing room and came back — the round trip unmounts this
   * component, so React state alone cannot carry the checklist across.
   * Completion markers written by SigningRoom are merged in here.
   */
export function restorePostApplySessionFor({
  companyData,
  slug,
  setPostSubmitDocs,
  setSubmittedApplicationId,
  setSubmittedConfirmationNumber,
  setSubmissionStatus,
}) {

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
  
}

/** The company load: sandbox / E2E / production, with the local-draft restore. */
export async function loadPublicApplyCompany({
  slug,
  sandbox,
  searchParams,
  loadGeneration,
  resetGenerationRef,
  restoredFromDraftRef,
  draftIdRef,
  discardedElsewhere,
  restorePostApplySession,
  // Through the resume hook, not `writeResumeToken` directly: writing the shared
  // slot behind the hook's back left the ownership refs unset, and this path only
  // worked because the resume lookup happened to re-read the slot and find it.
  adoptResumeToken,
  // Where the exchange's verdict goes. `PublicApplyHandler` gates the server-draft
  // reconciliation on it and renders the failure screen from it.
  setInviteOutcome,
  setCurrentCompanyProfile,
  setError,
  setLoading,
  setCompany,
  setFormData,
  setCurrentStep,
  setIntakeMode,
}) {
    /**
     * A link the carrier sent, carrying an application it prepared.
     *
     * Taken before the local-draft restore, because it is the stronger claim: this
     * browser may hold an abandoned attempt of its own, and what the driver
     * clicked is the application their carrier filled in for them. Taken before
     * the post-apply session restore too, and that ordering is the whole of the
     * fix for a stale confirmation screen hiding a live invitation.
     *
     * The exchange also mints a resume token for this draft. A carrier-prepared
     * draft has no identity HMAC — the carrier does not know the driver's Social
     * Security Number — so that token is the only thing that will authorize the
     * driver's own autosave from here on. `adoptOpenedApplication` takes it on the
     * moment it arrives, before anything further down can go wrong, and is shared
     * with the identity-confirmation path in `PublicApplyHandler` so the two
     * cannot diverge.
     *
     * @returns {Promise<object>} the outcome, which the caller branches on
     */
    async function openInvite(companyData) {
      const outcome = await openPreparedApplication({
        slug, companyId: companyData.id, searchParams,
      });
      setInviteOutcome(outcome);
      if (outcome.status === INVITE_OUTCOMES.REQUIRES_IDENTITY) {
        // A live application the driver has already started, waiting on one
        // question. Nothing is adopted — there is no token and no answers in this
        // reply — but the stale success screen has to go now rather than when the
        // claim succeeds, because it renders ABOVE the question and would hide it.
        retireStalePostApplySession(companyData.id);
      }
      if (outcome.status !== INVITE_OUTCOMES.OPENED) return outcome;

      adoptOpenedApplication({
        outcome,
        companyId: companyData.id,
        adoptResumeToken,
        restoredFromDraftRef,
        draftIdRef,
        setFormData,
        setCurrentStep,
        setIntakeMode,
      });
      setLoading(false);
      return outcome;
    }

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
          // Same order as the production branch below, and kept that way
          // deliberately: the comment there records that a divergence between the
          // two is exactly why a browser test could not see an earlier bug.
          const e2eInvite = await openInvite(mockCompany);
          if (e2eInvite.status === INVITE_OUTCOMES.OPENED) return;
          // Same decision as the production branch, from the same function.
          const e2ePermits = permissionsAfterInvite(e2eInvite);
          if (e2ePermits.restoreSubmission) restorePostApplySession(mockCompany);
          if (getE2EQueryParam('e2eIntake', 'manual') !== 'choice') {
            setIntakeMode('manual');
          }
          const e2eDraft = e2ePermits.restoreLocalDraft ? readApplicationDraft(slug) : null;
          if (e2eDraft) {
            // Same flag as the production path below: stored content on screen, so a
            // discard elsewhere takes it with it. Kept in step so a browser test
            // exercises the behaviour production has, not a weaker one.
            restoredFromDraftRef.current = true;
            draftIdRef.current = e2eDraft.meta?.draftId || null;
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

        // Deliberately AFTER the company is set. `openInvite` returns straight out
        // of `loadCompany`, and the wizard it hands the driver reads
        // `company.companyName` -- so opening the invite first left every real
        // carrier-sent link rendering against no company at all. The E2E branch
        // above sets the company before calling it, which is precisely why a
        // browser test could not see this. The two branches now agree.
        //
        // And deliberately BEFORE the post-apply session restore, which is the
        // reorder that stops a 24-hour-old confirmation screen for this carrier
        // hiding a live invitation. `openInvite` explains why clearing that
        // session on success cannot cost a real submitted application anything.
        const invite = await openInvite(companyData);
        if (invite.status === INVITE_OUTCOMES.OPENED) return;

        /**
         * What a live-but-unopened invitation leaves the rest of this load allowed
         * to do. `requires_identity` is the case that needs it: the two restores
         * below would render a stale success screen over the confirmation question
         * and load a previous applicant's answers behind it. See
         * `permissionsAfterInvite`.
         */
        const permits = permissionsAfterInvite(invite);

        // Returning from the signing room (or a reload right after submitting):
        // bring back the success screen + required-documents checklist. Reached
        // when an invitation FAILED too — a dead link must not take away a success
        // screen — but not while a live one is asking the driver to confirm.
        if (permits.restoreSubmission) restorePostApplySession(companyData);

        // P2-5 FIX: Recover saved draft from localStorage on page revisit.
        //
        // The step is honoured as well as the fields. Restoring the answers and
        // then showing page one meant a returning applicant had to click Next
        // eight times past forms that were already filled in, which reads as
        // "nothing was saved".
        const savedDraft = permits.restoreLocalDraft ? readApplicationDraft(slug) : null;
        // Discarded while the profile was loading, either way it can happen. If the
        // event was delivered, the reaction has already adopted the mark — it ran with
        // nothing on screen to reset — so every later comparison reads clean and only
        // the reset counter still remembers, which is why the reconciliation effect uses
        // it too. If it was written before the listener existed, no event was delivered
        // and the counter never moved, but the mark this tab loaded with is still
        // different from the one in storage. Either way, restoring would put the
        // discarded answers on screen.
        if (savedDraft && resetGenerationRef.current === loadGeneration
          && !discardedElsewhere()) {
          // Stored content on screen, so a discard elsewhere takes it with it, and
          // this tab has taken on that draft — which application it is matters if a
          // submission from here has to be closed out later.
          restoredFromDraftRef.current = true;
          draftIdRef.current = savedDraft.meta?.draftId || null;
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
  return loadCompany();
}
