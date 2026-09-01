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
import {
  readApplicationDraft,
  saveApplicationDraft,
  draftSyncState,
  sameDraftData,
} from './applicationDraftStorage';
import {
  DOC_STATUS,
  savePostApplySession,
  readPostApplySession,
  isRequestSigned,
} from './postApplyDocsStorage';
import { reconcileApplicationDraft } from './reconcileApplicationDraft';

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
  setCurrentCompanyProfile,
  setError,
  setLoading,
  setCompany,
  setFormData,
  setCurrentStep,
  setIntakeMode,
}) {
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

/**
 * The server-draft reconciliation, once the company is known. Returns the
 * effect's own cleanup, exactly as the inline body did.
 */
export function reconcileServerDraftOnLoad({
  slug,
  resetGenerationRef,
  restoredFromDraftRef,
  draftIdRef,
  discardGuardsRef,
  latestDraftRef,
  restoreFromStoredToken,
  setFormData,
  setCurrentStep,
  setIntakeMode,
}) {
    let current = true;
    const generation = resetGenerationRef.current;
    restoreFromStoredToken().then((restored) => {
      if (!current || !restored) return;
      // Discarded while this fetch was open. The read itself succeeded, so nothing
      // looks wrong, and writing its result back would put the discarded answers
      // into storage *after* the reset cleared them — to be restored on the next
      // load. Checked by generation rather than by mark, because reacting to the
      // discard adopted the mark already.
      if (resetGenerationRef.current !== generation) return;
      const guards = discardGuardsRef.current;
      // This used to be `{ ...prev, ...restored.formData }`, which made the server
      // copy win every field it held whether or not it was the newer one. That
      // destroyed the local backup with the very failure it exists to survive: a
      // save fails, the driver refreshes, and the older server values come back
      // over their edits with nothing said.
      //
      // The local copy is re-read here rather than relied upon through `prev`, so
      // the decision does not depend on the order two effects happen to run in.
      // All of this outside the updater: a `setFormData` updater has to stay pure,
      // because React may invoke it more than once, and one of the steps below
      // writes to storage.
      const resolved = reconcileApplicationDraft({
        local: readApplicationDraft(slug),
        server: restored,
        live: latestDraftRef.current.formData,
      });
      if (!resolved) return;

      // A discard this tab has not noticed yet — no `storage` event delivered, or
      // one it was suspended through — is caught here, where the generation check
      // above cannot see it.
      if (guards.discardedElsewhere()) {
        guards.handleDiscardedElsewhere();
        return;
      }

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
        const reconciled = saveApplicationDraft(slug, resolved.formData, holdsMoreThanServer
          // One above the server's position, with the synced position left at it:
          // dirty, so the next navigation or reconnect sends it, while a later
          // genuine server advance is still recognised by `clientSeq !== syncedSeq`.
          ? {
            lastStep: resolved.stepIndex,
            localSeq: (serverSeq ?? 0) + 1,
            syncedSeq: serverSeq ?? 0,
            draftId: draftIdRef.current,
          }
          : {
            lastStep: resolved.stepIndex,
            localSeq: serverSeq ?? undefined,
            synced: true,
            draftId: draftIdRef.current,
          });
        if (reconciled.draftId) draftIdRef.current = reconciled.draftId;
      }

      // Restored content, whichever copy won: both the local draft and the server
      // draft are *stored* copies of the application, so a discard elsewhere means
      // what is on screen is the discarded application. Only answers typed in this
      // tab and never stored survive one.
      restoredFromDraftRef.current = true;
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
}

/**
 * The reconnect flush: sends the local copy when the connection returns and
 * it is actually owed a save. Returns the effect's own cleanup.
 */
export function listenForReconnectFlush({
  slug,
  discardGuardsRef,
  latestDraftRef,
  draftIdRef,
  saveDraftToServer,
}) {
    const flush = () => {
      // The longest-delayed writer there is: the applicant may have discarded in
      // another tab at any point while this one waited for a connection.
      const guards = discardGuardsRef.current;
      if (guards.discardedElsewhere()) {
        guards.handleDiscardedElsewhere();
        return;
      }
      const state = draftSyncState(slug);
      if (!state?.dirty) return;
      const { formData: latest, currentStep: step } = latestDraftRef.current;
      saveDraftToServer({
        formData: latest,
        stepIndex: step,
        localSeq: state.localSeq,
        // Which application this owes a save for. The acknowledgement is scoped to it,
        // because a reconnect can be minutes after the fact.
        draftId: draftIdRef.current,
      });
    };
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
}
