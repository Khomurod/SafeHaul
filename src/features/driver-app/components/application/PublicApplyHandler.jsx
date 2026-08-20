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
  readDiscardMark,
  writeDiscardMark,
  discardMarkReason,
  subscribeToDiscardMark,
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
import { clearResumeToken, closeDraftAfterSubmission } from '../../services/applicationDraftService';
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
   * The discard mark this tab loaded with.
   *
   * `null` means "no discard had happened when I started", which is the ordinary
   * case. Anything else is the mark of a discard that had already occurred, and
   * adopting it is what stops this tab from treating old history as news.
   */
  const discardMarkRef = useRef(readDiscardMark(slug));
  /**
   * Whether what is on screen came out of a stored draft.
   *
   * Decides what a discard elsewhere costs this tab. If these answers were
   * *restored*, they **are** the discarded application and must go. If the
   * applicant typed them here, they are their own work and a discard somewhere else
   * is no reason to destroy them — they simply become the start of a new
   * application.
   */
  const restoredFromDraftRef = useRef(false);
  /**
   * Bumped every time a discard is observed.
   *
   * The mark alone is not enough for work that is already in flight. Reacting to a
   * discard *adopts* the new mark — it has to, or the tab would react to its own
   * history forever — so an asynchronous step that started before the reset finds
   * the mark comparison clean again and carries on writing. A counter captured
   * before the await and re-read after it asks the question that actually matters:
   * "did anything get discarded while I was waiting?"
   */
  const resetGenerationRef = useRef(0);
  /**
   * Which application *this tab* is working on, by the draft's own opaque name.
   *
   * Deliberately a ref rather than a read of storage when it is needed. `localStorage`
   * is shared, so by the time an offline submission finally lands the value there may
   * belong to an application another tab began — and stamping a queued submission with
   * somebody else's identity would let it close out their unsent work. Remembered when
   * this tab writes or restores a draft, which is exactly when it takes one on.
   */
  const draftIdRef = useRef(null);

  /**
   * Has this application been discarded since this tab loaded it?
   *
   * Read fresh from storage every time rather than cached: the whole point is that
   * another tab may have changed it a moment ago.
   */
  const discardedElsewhere = useCallback(() => {
    if (!slug || sandbox) return false;
    // Any change means this application's life ended somewhere. Deliberately not
    // narrowed by the draft's name: two tabs on the same application hold different
    // local names, so a name test makes a tab ignore the very discard it must react to.
    return readDiscardMark(slug) !== discardMarkRef.current;
  }, [slug, sandbox]);

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
    forgetDraftOwnership,
  } = useApplicationResume({
    slug,
    companyId: company?.id,
    sandbox,
    hasCustomQuestions: customQuestions.length > 0,
    hasBeenDiscarded: discardedElsewhere,
  });

  /**
   * Reacts to this application being discarded somewhere else.
   *
   * Two ways in, deliberately: the `storage` event, which arrives within
   * milliseconds and is how the screen updates on its own, and a check before every
   * write, which is what makes the delayed, queued and offline-reconnect cases
   * deterministic rather than dependent on an event this tab might have been
   * suspended through.
   *
   * What it costs this tab depends on where its answers came from — see
   * `restoredFromDraftRef`.
   */
  const handleDiscardedElsewhere = useCallback(() => {
    // A submitted application is finished, and nothing about a discarded *draft*
    // may reach back into it. Resetting here would throw away the success screen,
    // the confirmation number and the post-submission documents checklist — the
    // one moment in this flow where the applicant has something they cannot get
    // back. A submission in flight is left alone for the same reason.
    // Bumped before the exemption, not after it: in-flight work has to abort in this
    // case too. A submitted application must not have a draft written back for it
    // either, which is the other half of the same rule.
    const mark = readDiscardMark(slug);

    resetGenerationRef.current += 1;

    if (submissionStatus === 'submitting' || submissionStatus === 'success' || submissionStatus === 'queued') {
      discardMarkRef.current = readDiscardMark(slug);
      return;
    }

    // The reason decides the wording, and the applicant is owed the true one.
    const submitted = discardMarkReason(mark) === 'submit';
    // Adopted first, so nothing below can re-enter this.
    discardMarkRef.current = mark;
    // Whatever happens to the answers, the application they belonged to is over, so its
    // name must not carry into the next draft this tab writes — in the branch below
    // that keeps the answers just as much as in the one that clears them, because there
    // the code is saying outright that they will start a new application.
    draftIdRef.current = null;
    // This browser owns nothing now: the next save must ask the resume question
    // again rather than silently creating.
    forgetDraftOwnership();
    clearResumeToken(slug);

    if (restoredFromDraftRef.current) {
      // These answers *are* the discarded application. Keeping them on screen
      // would be showing the applicant the thing they just deleted.
      restoredFromDraftRef.current = false;
      // The stored copy goes with them, and only here: in the other branch the slot
      // holds this tab's own application, and deleting that would destroy the backup
      // of work the applicant is still typing.
      clearApplicationDraft(slug);
      setFormData({});
      setCurrentStep(0);
      setIntakeMode(null);
      showInfo(submitted
        ? 'That application was submitted in another tab. Starting fresh.'
        : 'That saved application was discarded in another tab. Starting fresh.');
      return;
    }

    // Typed here, so it is the applicant's own work and stays. It is simply no
    // longer attached to the draft that was deleted.
    showInfo(submitted
      ? 'That application was submitted in another tab. Your answers here will start a new one.'
      : 'The saved application was discarded in another tab. Your answers here will start a new one.');
  }, [slug, submissionStatus, forgetDraftOwnership, showInfo]);

  /**
   * A stable handle on the two discard callbacks.
   *
   * Neither is stable itself: `handleDiscardedElsewhere` closes over `showInfo`,
   * which `ToastProvider` rebuilds on every render. Naming them as effect
   * dependencies therefore re-runs those effects on every render — which, for the
   * server-reconciliation effect below, means re-fetching the draft and rewriting
   * the local copy over and over instead of once on load. Same reasoning as
   * `latestDraftRef`.
   */
  const discardGuardsRef = useRef({ discardedElsewhere, handleDiscardedElsewhere });
  discardGuardsRef.current = { discardedElsewhere, handleDiscardedElsewhere };

  /**
   * Notices a discard from another tab while this one is sitting idle.
   *
   * Sandbox is excluded along with everything else about resuming: a sandbox
   * application is a disposable demo with nothing to discard.
   */
  useEffect(() => {
    if (!slug || sandbox) return undefined;
    return subscribeToDiscardMark(slug, () => discardGuardsRef.current.handleDiscardedElsewhere());
  }, [slug, sandbox]);

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
        if (savedDraft) {
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
    const { localSeq, draftId } = saveApplicationDraft(slug, formData, {
      lastStep: stepIndex,
      // What *this* tab owns, so a slot another tab filled first does not lend this
      // write its name. Null means "I own none", which mints a new one.
      draftId: draftIdRef.current,
    });
    if (draftId) draftIdRef.current = draftId;
    return localSeq;
  }, [slug, sandbox, formData]);

  const handleNavigate = (direction) => {
    let nextStep = currentStep;
    if (direction === 'next') nextStep = currentStep + 1;
    else if (direction === 'back') nextStep = Math.max(0, currentStep - 1);
    else if (typeof direction === 'number') nextStep = direction;

    // Before the step moves, not just before the write. Advancing and then
    // refusing to persist would leave the applicant a page further on with nothing
    // recorded; this way the click does nothing except explain itself, and their
    // next one behaves normally.
    if (discardedElsewhere()) {
      handleDiscardedElsewhere();
      return;
    }

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
    const written = saveApplicationDraft(slug, { ...formData, ...restored.formData }, {
      lastStep: restored.stepIndex,
      localSeq: Number.isInteger(restored.clientSeq) ? restored.clientSeq : undefined,
      synced: true,
      draftId: draftIdRef.current,
    });
    if (written.draftId) draftIdRef.current = written.draftId;
    // What is on screen now came out of the stored draft, which decides what a
    // discard elsewhere costs this tab.
    restoredFromDraftRef.current = true;
    showSuccess('Your saved application has been restored.');
  }, [slug, formData, showSuccess]);

  const handleContinueExisting = useCallback(async () => {
    applyRestoredDraft(await continueExisting());
  }, [continueExisting, applyRestoredDraft]);

  /**
   * Closes the draft's life once the application has actually been submitted.
   *
   * The server discards the draft on submission (`discardDraftForApplication`), so
   * afterwards the resume token is a credential for a document that no longer
   * exists and the same in-memory staleness applies: a second tab still holding
   * these answers would otherwise autosave them back and put an applicant who has
   * already applied into the recruiter's "started, incomplete" list.
   *
   * The queued path deliberately does not call this. That submission has not
   * reached the server yet, so its draft is still the live record of the
   * application, and the offline queue owns getting it the rest of the way.
   */
  const finishDraftLifecycle = useCallback(() => {
    if (!slug) return;
    if (sandbox) {
      // A sandbox application is a disposable demo: nothing to tell other tabs, no
      // token to drop, and no other application can be sharing the slot.
      clearApplicationDraft(slug);
      return;
    }
    // The same writes the offline queue performs when a submission it was holding
    // finally lands, from one place so the two cannot drift — scoped, as there, to the
    // application this tab actually submitted.
    discardMarkRef.current = closeDraftAfterSubmission(slug, { draftId: draftIdRef.current })
      ?? discardMarkRef.current;
    // This application is finished, so its name must not carry into the next one.
    draftIdRef.current = null;
    // This tab's own save queue goes too, and adopting the mark above is exactly why
    // it has to be said explicitly: `hasBeenDiscarded` stays false here, so a payload
    // already waiting behind an in-flight save would still be drained — and, with the
    // token now cleared, sent token-less, which the server accepts as a first save.
    // The result would be a fresh unfinished draft for somebody who has just
    // submitted. The request already on the wire is refused server-side, because it
    // carries the token of the draft submission deleted.
    forgetDraftOwnership();
  }, [slug, sandbox, forgetDraftOwnership]);

  const handleStartOver = useCallback(async () => {
    if (!(await startOver())) return;
    // The local copy goes first, and the order is deliberate. A genuinely new
    // application must not find the old one on the next reload — but clearing it also
    // *frees space*, and the mark below is the only thing that tells the other tabs
    // anything. Writing the mark while a large draft still fills the quota can fail,
    // and by then `startOver` has already removed the shared resume token: the other
    // tab would see neither a token nor a changed mark, and its next save would be
    // accepted as a token-less first save, recreating what was just deleted.
    //
    // Scoped to what this tab was working on, because `startOver` awaited the server:
    // another tab can have written a different application into that slot in the
    // meantime, and that draft is unsent work.
    const inSlot = readApplicationDraft(slug)?.meta?.draftId || null;
    if (!inSlot || !draftIdRef.current || inSlot === draftIdRef.current) {
      clearApplicationDraft(slug);
    }
    // Adopted as this tab's own mark in the same breath, which is what keeps this tab
    // from mistaking its own discard for somebody else's and resetting the new
    // application it is about to begin.
    discardMarkRef.current = writeDiscardMark(slug) ?? discardMarkRef.current;
    restoredFromDraftRef.current = false;
    // The discarded application's name goes too. Keeping it would name the *new*
    // application after the one just deleted, and anything still holding that name —
    // a queued submission, most of all — would act on the wrong draft.
    draftIdRef.current = null;
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
    if (discardedElsewhere()) {
      handleDiscardedElsewhere();
      return;
    }
    const { ok, localSeq, draftId } = saveApplicationDraft(slug, formData, {
      lastStep: currentStep,
      draftId: draftIdRef.current,
    });
    if (draftId) draftIdRef.current = draftId;
    if (ok) {
      saveDraftToServer({ formData, stepIndex: currentStep, localSeq });
      showSuccess("Progress saved.");
    } else {
      showError("Could not save progress locally. Your data is still here — please continue filling the form.");
    }
  };

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
  const submittedDraftIdentity = useCallback(() => ({
    applySlug: slug,
    // This tab's own record, and *only* that. Falling back to a read of storage would
    // be the same mistake in a quieter place: if this tab's writes failed on quota
    // while another tab stored a draft for the same page, the read would hand this
    // submission the other tab's name and let it close their unsent work. Null when
    // this tab never took on a stored draft, which the close treats as "act only if
    // storage holds no draft either".
    applyDraftId: draftIdRef.current || null,
  }), [slug]);

  const handleFinalSubmit = async () => {
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
            { type: 'guest', userId: null, ...submittedDraftIdentity() },
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
            ...submittedDraftIdentity(),
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
        // — seconds in which another tab can discard, and the reaction exempts a
        // submission in flight precisely so it cannot wipe one that has landed. So the
        // last word before the callable is this: nothing has changed since the
        // applicant pressed the button.
        if (discardedElsewhere()) {
          // The queue entry goes first. It was written before the attempts for
          // guaranteed delivery, and leaving it would replay the discarded answers
          // hours later — the very hole the queue close exists to plug.
          if (queueId) {
            try {
              await dequeueSubmission(queueId);
            } catch (dequeueError) {
              console.warn('[PublicApplyHandler] Dequeue after a discard failed:', dequeueError);
            }
          }
          // Cleared before reacting, because the reaction deliberately leaves a
          // submission in flight alone — and this one is being abandoned, not landed.
          setSubmissionStatus(null);
          isSubmittingRef.current = false;
          handleDiscardedElsewhere();
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
    // A genuinely new application. `finishDraftLifecycle` has already forgotten the
    // submitted one's name; this is here so the invariant holds from either direction,
    // including a queued submission that has not landed yet.
    draftIdRef.current = null;
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
