// src/features/driver-app/components/application/PublicApplyHandler.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import Stepper from '@shared/components/layout/Stepper';
import { IntakeChooser } from './IntakeChooser';
import {
  getFieldConfig,
  normalizePostApplicationTemplates,
} from './publicApplyHelpers';
import { useGuestFileUpload } from '../../hooks/useGuestFileUpload';
import { useCdlAutoFill } from '../../hooks/useCdlAutoFill';
import {
  ApplyLoadingScreen,
  ApplyLinkErrorScreen,
  ParsingCdlScreen,
  SubmissionSuccessScreen,
  SubmissionQueuedScreen,
} from './PublicApplyScreens';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { useData } from '@/context/DataContext';
import { ResumeApplicationDialog } from './ResumeApplicationDialog';
// The submission path lives in publicApplySubmit.js since the 2026-09-01
// source-size split (PA-1a); the bootstrap — session restore, company load,
// server-draft reconciliation and the reconnect flush — in
// publicApplyBootstrap.js since PA-1b.
import { submitPublicApplication } from './publicApplySubmit';
import {
  restorePostApplySessionFor,
  loadPublicApplyCompany,
  reconcileServerDraftOnLoad,
  listenForReconnectFlush,
} from './publicApplyBootstrap';
// And the PA-1c split: the circular discard/resume pair, the draft
// lifecycle, and the post-submission documents flow.
import { useDiscardAwareResume } from './useDiscardAwareResume';
import { useDraftLifecycle } from './useDraftLifecycle';
import { usePostSubmitDocuments } from './usePostSubmitDocuments';

// Bulletproof submission imports
import { Card } from '@/design-system/components';
import { getMagicFillPatchForStep } from '@features/sandbox/utils/dummyDataGenerator';
import { SandboxActionPanel } from '@features/sandbox/SandboxActionPanel';
import { SANDBOX_APP_SLUG } from '@features/sandbox/sandboxConstants';

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
  // The cross-tab discard machinery — this tab's identity refs, the two
  // discard callbacks, the guards ref, the storage-event subscription — and
  // the server resume flow live together in useDiscardAwareResume since the
  // 2026-09-01 source-size split (PA-1c); the pair is circular, which is why
  // one hook owns both. See its header.
  const {
    discardMarkRef,
    restoredFromDraftRef,
    resetGenerationRef,
    draftIdRef,
    discardedElsewhere,
    handleDiscardedElsewhere,
    discardGuardsRef,
    resumePrompt,
    resumeBusy,
    resumeError,
    saveDraftToServer,
    restoreFromStoredToken,
    continueExisting,
    startOver,
    forgetDraftOwnership,
  } = useDiscardAwareResume({
    slug,
    sandbox,
    companyId: company?.id,
    hasCustomQuestions: customQuestions.length > 0,
    submissionStatus,
    showInfo,
    setFormData,
    setCurrentStep,
    setIntakeMode,
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
  const restorePostApplySession = useCallback((companyData) => restorePostApplySessionFor({
    companyData,
    slug,
    setPostSubmitDocs,
    setSubmittedApplicationId,
    setSubmittedConfirmationNumber,
    setSubmissionStatus,
  }), [slug]);

  // 1. Load Company Info from Slug (or fixed SANDBOX public profile when `sandbox`)
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    // Captured before the first await, and compared after: see the local restore below.
    const loadGeneration = resetGenerationRef.current;

    loadPublicApplyCompany({
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
    });
  }, [slug, sandbox, searchParams, setCurrentCompanyProfile, restorePostApplySession, resetGenerationRef, restoredFromDraftRef, draftIdRef]);

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
    return reconcileServerDraftOnLoad({
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
    });
  }, [company?.id, sandbox, slug, restoreFromStoredToken, resetGenerationRef, restoredFromDraftRef, draftIdRef, discardGuardsRef]);

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
    return listenForReconnectFlush({
      slug,
      discardGuardsRef,
      latestDraftRef,
      draftIdRef,
      saveDraftToServer,
    });
  }, [slug, sandbox, company?.id, saveDraftToServer, discardGuardsRef, draftIdRef]);

  // 2. Form Handlers
  const handleUpdateFormData = (name, value) => {
    setFormData((prev) => ({
      ...prev,
      [name]: typeof value === 'function' ? value(prev[name]) : value,
    }));
  };

  // The draft lifecycle — the synchronous per-step local write, Continue's
  // restore-and-mark-synced path, the post-submission close, Start Over, and
  // Save-as-Draft — lives in useDraftLifecycle since the 2026-09-01
  // source-size split (PA-1c).
  const {
    handleNavigate,
    handleContinueExisting,
    finishDraftLifecycle,
    handleStartOver,
    handlePartialSubmit,
  } = useDraftLifecycle({
    slug,
    sandbox,
    formData,
    currentStep,
    draftIdRef,
    restoredFromDraftRef,
    discardMarkRef,
    discardedElsewhere,
    handleDiscardedElsewhere,
    continueExisting,
    startOver,
    forgetDraftOwnership,
    saveDraftToServer,
    setFormData,
    setCurrentStep,
    setIntakeMode,
    showSuccess,
    showError,
    showInfo,
  });

  const handleMagicFillStep = useCallback(() => {
    const patch = getMagicFillPatchForStep(currentStep, {
      hasCustomQuestions: customQuestions.length > 0,
    });
    setFormData((prev) => ({ ...prev, ...patch }));
  }, [currentStep, customQuestions]);

  const handleChooseManual = () => {
    setIntakeMode('manual');
  };


  // The submission path — pre-flight validation, the queue-first guaranteed
  // delivery, the three-attempt Cloud Function call and every discard
  // re-check — lives in publicApplySubmit.js since the 2026-09-01
  // source-size split (PA-1a). One expression, so the caller awaits the
  // module's own promise; this tab's refs are passed as the objects
  // themselves so their capture-then-re-read semantics are unchanged.
  const handleFinalSubmit = () => submitPublicApplication({
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
    discardMarkRef,
    resetGenerationRef,
    draftIdRef,
    isSubmittingRef,
    discardedElsewhere,
    handleDiscardedElsewhere,
    finishDraftLifecycle,
    setCurrentStep,
    setSubmissionStatus,
    setSubmittedApplicationId,
    setSubmittedConfirmationNumber,
    setPostSubmitDocs,
    setSandboxSubmission,
    showError,
    showSuccess,
  });

  // The post-submission Required Documents flow lives in
  // usePostSubmitDocuments since the 2026-09-01 source-size split (PA-1c).
  const {
    handleStartNewApplication,
    handleOpenPostApplicationTemplate,
  } = usePostSubmitDocuments({
    slug,
    sandbox,
    company,
    submittedApplicationId,
    submittedConfirmationNumber,
    openingTemplateId,
    setOpeningTemplateId,
    setPostSubmitDocs,
    setSubmissionStatus,
    setSubmittedApplicationId,
    setSubmittedConfirmationNumber,
    setFormData,
    setCurrentStep,
    draftIdRef,
    navigate,
    showError,
    showSuccess,
  });

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
      <header className="sticky top-0 z-ds-sticky border-b border-ds-border-subtle bg-ds-surface px-ds-4 py-ds-3 shadow-ds-xs">
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
