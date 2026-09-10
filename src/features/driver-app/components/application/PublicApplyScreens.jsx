import React, { useId } from 'react';
import { AlertCircle, Building2 } from '@design-system/icons';
import { Button } from '@/design-system/components';
import { ErrorState, LoadingState, PageState } from '@design-system/patterns';
import { SandboxActionPanel } from '@features/sandbox/SandboxActionPanel';
import { ApplyIdentityCheckScreen } from './ApplyIdentityCheckScreen';
import { IntakeChooser } from './IntakeChooser';
import { RequiredDocumentsChecklist } from './RequiredDocumentsChecklist';
import { DOC_STATUS } from './postApplyDocsStorage';

/**
 * Full-page status screens for the public (guest) application flow.
 *
 * Presentation is migrated to the approved `Card` / `Button` / `StatusMedallion`
 * primitives and `--ds-*` tokens, matching the public signing room's status
 * screens. Every user-facing string is frozen — "Loading Application...",
 * "Link Error", "Reading your CDL...", "Application Submitted!", "Confirmation
 * Number", "Application Saved", "Go to home" and "Start a new application" are
 * asserted by `e2e/public-application.spec.cjs`,
 * `e2e/guest-offline-queue.spec.cjs` and
 * `e2e/guest-post-application-edoc.spec.cjs` — as are the
 * `sessionStorage.lastConfirmationNumber` fallback, the
 * `postApplicationTemplates.length > 0 && submittedApplicationId` checklist
 * gate, and the pending-required-document message switch.
 *
 * DEFECTS FIXED (2026-07-27): none of these screens was a `<main>` landmark,
 * none had an `<h1>` (they opened at `<h2>`, so an applicant landing on one
 * heard an unlabelled page), the loading and queued states were not announced,
 * and the "Go to home" / "Start a new application" controls were bare
 * `<button>`s styled as text links with no affordance beyond hover.
 *
 * **2026-08-25: all five screens are the approved page-state pattern.** They were
 * hand-composed `Card` + `StatusMedallion` + heading + body + actions, which is
 * what `PageState` is — it was built later and never applied back here. Measured
 * across these five and the four in the signing room, one kind of screen had two
 * title sizes, two medallion sizes, icons at 28/32/40/48px and three different
 * gaps under the medallion. The pattern owns the shape now; this feature keeps
 * the words, the tone, the icon, the actions and the domain logic (the
 * confirmation-number fallback, the checklist gate, the pending-required switch).
 *
 * Two capabilities were added to the pattern rather than kept here, because both
 * are general: `children`, for the confirmation panel and the outstanding-document
 * checklist, and `focusOnMount`, which is the focus move this screen had written
 * by hand — a state that replaces the button the user just pressed leaves focus on
 * `<body>` unless something moves it.
 */

/** Shared centred page shell so every screen has one layout contract. */
function StatusPage({ children, labelledBy }) {
  return (
    <main
      aria-labelledby={labelledBy}
      className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4"
    >
      {children}
    </main>
  );
}

export function ApplyLoadingScreen() {
  const headingId = `apply-loading-${useId().replace(/:/g, '')}`;
  return (
    <StatusPage labelledBy={headingId}>
      {/* `role="status"` is not valid on `<main>`, so the landmark and the
          announcement are separate elements — which is why the state's heading
          needs an id for the landmark to point at. */}
      <LoadingState
        surface="bare"
        headingLevel={1}
        titleId={headingId}
        title="Loading Application..."
      />
    </StatusPage>
  );
}

export function ApplyLinkErrorScreen({ error }) {
  const headingId = `apply-link-error-${useId().replace(/:/g, '')}`;
  return (
    <StatusPage labelledBy={headingId}>
      {/*
        * The width lives on a wrapper rather than on `className`. A page state's
        * `className` reaches the state element itself — that is how `LoadingState`
        * adds its spin class — while its remaining props reach the `Card`, so
        * constraining the surface is the wrapper's job. `ErrorBoundary` already
        * uses the same shape.
        */}
      <div className="w-full max-w-md">
        <ErrorState
          icon={AlertCircle}
          headingLevel={1}
          titleId={headingId}
          title="Link Error"
          /* A link error can carry an unbroken URL or token. */
          description={<span className="[overflow-wrap:anywhere]">{error}</span>}
        />
      </div>
    </StatusPage>
  );
}

export function ParsingCdlScreen({ autoFillStoragePath }) {
  const headingId = `apply-parsing-cdl-${useId().replace(/:/g, '')}`;
  return (
    <StatusPage labelledBy={headingId}>
      <div className="w-full max-w-md">
        <LoadingState
          headingLevel={1}
          titleId={headingId}
          title="Reading your CDL..."
          description="Our AI is extracting your basic details so you can skip typing."
        >
          {autoFillStoragePath && (
            <p className="text-center text-ds-xs text-ds-content-muted [overflow-wrap:anywhere]">
              {autoFillStoragePath}
            </p>
          )}
        </LoadingState>
      </div>
    </StatusPage>
  );
}

/**
 * A carrier's link that would not open, and the way forward from it.
 *
 * Its own screen rather than a reuse of `ApplyLinkErrorScreen`, deliberately.
 * That one takes only `{ error }`, renders no actions — so there is no explicit
 * choice on it — and its title "Link Error" is a frozen string that already means
 * *"this company does not exist"*. Reusing it would conflate a dead company with
 * a dead invitation and could not carry the two buttons this needs.
 *
 * Both actions matter, and which one leads is a decision rather than a
 * preference. A silent fall-through — what this replaces — never stamps
 * `inviteClaimedAt`, so the carrier's locked employers go unenforced and it
 * receives a second, unprepared application. When the failure is transient,
 * retrying is what prevents that duplicate, so `onRetry` leads when it is
 * offered. Continuing is always available and always explicit: starting a fresh
 * application is a choice the driver makes, never a fallback that happens to
 * them.
 *
 * The message comes from `buildApplyLinkOutcomeMessage`, which keeps a wrong link
 * and an expired one indistinguishable and says nothing about whether another
 * person's application exists.
 */
export function ApplyLinkProblemScreen({ message, onRetry, onContinue }) {
  const headingId = `apply-link-problem-${useId().replace(/:/g, '')}`;
  return (
    <StatusPage labelledBy={headingId}>
      <div className="w-full max-w-md">
        <ErrorState
          icon={AlertCircle}
          headingLevel={1}
          titleId={headingId}
          focusOnMount
          title="This link could not be opened"
          description={message}
          actions={(
            <>
              {onRetry && (
                <Button variant="primary" onClick={onRetry}>Try again</Button>
              )}
              <Button variant={onRetry ? 'secondary' : 'primary'} onClick={onContinue}>
                Continue to the application
              </Button>
            </>
          )}
        />
      </div>
    </StatusPage>
  );
}

export function SubmissionSuccessScreen({
  postApplicationTemplates,
  submittedApplicationId,
  docStates,
  openingTemplateId,
  handleOpenPostApplicationTemplate,
  onGoHome,
  onStartNewApplication,
  confirmationNumber,
}) {
  const headingId = `apply-submitted-${useId().replace(/:/g, '')}`;
  // DL-3: Display the confirmation number so applicants have a reference for follow-up.
  const confirmNum = confirmationNumber || sessionStorage.getItem('lastConfirmationNumber');
  const showChecklist = postApplicationTemplates.length > 0 && submittedApplicationId;
  const requiredTemplates = postApplicationTemplates.filter((t) => t.required !== false);
  const pendingRequired = requiredTemplates.filter(
    (t) => docStates?.[t.templateId]?.status !== DOC_STATUS.COMPLETED
  );
  const hasPendingRequired = showChecklist && pendingRequired.length > 0;

  return (
    <StatusPage labelledBy={headingId}>
      <div className="w-full max-w-md">
        <PageState
          /* The tone is the domain decision this feature keeps: outstanding
             required documents means the application is not finished yet. */
          tone={hasPendingRequired ? 'info' : 'success'}
          icon={Building2}
          announce="polite"
          headingLevel={1}
          titleId={headingId}
          /* The submit button that produced this screen is gone, so focus would
             otherwise sit on `<body>` and an applicant using a keyboard or a screen
             reader would not be told the application landed. */
          focusOnMount
          title="Application Submitted!"
          description={hasPendingRequired
            ? 'Your application has been received. To finish, please complete the required documents below.'
            : 'Your application has been received and a recruiter will contact you soon.'}
          actions={(
            <>
              <Button variant="ghost" onClick={onGoHome}>Go to home</Button>
              {onStartNewApplication && (
                <Button variant="ghost" onClick={onStartNewApplication}>
                  Start a new application
                </Button>
              )}
            </>
          )}
        >
          {confirmNum && (
            <div className="mb-ds-4 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle px-ds-4 py-ds-3 text-center">
              <p className="mb-ds-1 text-ds-xs uppercase tracking-wide text-ds-content-secondary">Confirmation Number</p>
              <p className="font-mono text-ds-body-lg font-bold text-ds-content [overflow-wrap:anywhere]">{confirmNum}</p>
              <p className="mt-ds-1 text-ds-xs text-ds-content-secondary">Save this number for your records.</p>
            </div>
          )}
          {showChecklist && (
            <RequiredDocumentsChecklist
              templates={postApplicationTemplates}
              docStates={docStates}
              openingTemplateId={openingTemplateId}
              onOpenTemplate={handleOpenPostApplicationTemplate}
            />
          )}
        </PageState>
      </div>
    </StatusPage>
  );
}

// P3-3 FIX: Queued status UI — shown when all direct submit attempts failed but data is queued
export function SubmissionQueuedScreen({ onGoHome }) {
  const headingId = `apply-queued-${useId().replace(/:/g, '')}`;
  return (
    <StatusPage labelledBy={headingId}>
      <div className="w-full max-w-md">
        <PageState
          tone="warning"
          icon={Building2}
          announce="polite"
          headingLevel={1}
          titleId={headingId}
          title="Application Saved"
          description="Your application has been securely saved and will be automatically submitted when your connection is restored."
          actions={<Button variant="ghost" onClick={onGoHome}>Go to home</Button>}
        >
          <p className="text-center text-ds-sm text-ds-content-muted">
            You can safely close this page. No data will be lost.
          </p>
        </PageState>
      </div>
    </StatusPage>
  );
}

/**
 * Which full-page status screen, if any, precedes the wizard.
 *
 * Moved out of `PublicApplyHandler` on 2026-09-08. This module already owns every
 * screen below, and the ORDER is load-bearing rather than incidental, so it
 * belongs with them: each position is protecting something, and three of the four
 * reasons were learned from a real defect.
 *
 *  1. **Loading and link error first**, because neither has a company to render
 *     against.
 *  2. **The submitted application above the intake chooser.** A restored
 *     post-submission session has no `intakeMode`, so putting the chooser first
 *     landed a returning driver on a fresh application instead of on their
 *     remaining signing tasks.
 *  3. **An unopenable carrier link below the success screen.** A driver who
 *     re-clicks their own dead link after submitting must keep their confirmation
 *     number and checklist — the one thing they cannot get back — so a dead link
 *     may not take it away.
 *  4. **And above the chooser**, so continuing to an ordinary application is a
 *     choice the driver makes rather than a fallback that happens to them. That
 *     silent fallback is what this position replaces.
 *  5. **The identity check in the same position, for the same reason.** A link
 *     whose application the driver has already started resolves to
 *     `requires_identity`, and until 2026-09-09 that outcome matched no branch at
 *     all — so the chooser rendered, and a driver sent a replacement link was
 *     offered a brand-new application with no mention of the one they had spent
 *     an hour on. It sits below the success screen because a confirmed
 *     submission outranks a request to confirm anything, and above the chooser
 *     because that fall-through IS the defect.
 *
 * Returns `null` when the wizard itself should render.
 */
export function resolveApplyStatusScreen({
  loading, error, isParsingCdl, autoFillStoragePath,
  sandbox, sandboxSubmission, onSandboxRestart,
  submissionStatus, postApplicationTemplates, submittedApplicationId, postSubmitDocs,
  openingTemplateId, handleOpenPostApplicationTemplate, submittedConfirmationNumber,
  onGoHome, onStartNewApplication,
  inviteProblem, inviteProblemDismissed, onContinueWithoutInvite,
  identityCheck, onConfirmIdentity,
  intakeMode, companyName, handleChooseAutoFill, handleChooseManual,
  cdlAutoFillInputRef, handleCdlAutoFillFileChange,
}) {
  if (loading) return <ApplyLoadingScreen />;
  if (error) return <ApplyLinkErrorScreen error={error} />;
  if (isParsingCdl) return <ParsingCdlScreen autoFillStoragePath={autoFillStoragePath} />;

  if (sandbox && sandboxSubmission) {
    return (
      <SandboxActionPanel
        applicationId={sandboxSubmission.applicationId}
        confirmationNumber={sandboxSubmission.confirmationNumber}
        onDeletedRestart={onSandboxRestart}
      />
    );
  }

  if (submissionStatus === 'success') {
    return (
      <SubmissionSuccessScreen
        postApplicationTemplates={postApplicationTemplates}
        submittedApplicationId={submittedApplicationId}
        docStates={postSubmitDocs}
        openingTemplateId={openingTemplateId}
        handleOpenPostApplicationTemplate={handleOpenPostApplicationTemplate}
        onGoHome={onGoHome}
        onStartNewApplication={onStartNewApplication}
        confirmationNumber={submittedConfirmationNumber}
      />
    );
  }

  if (inviteProblem && !inviteProblemDismissed) {
    return (
      <ApplyLinkProblemScreen
        message={inviteProblem.message}
        // A reload: the URL still carries `?invite=`, every other piece of state
        // is in storage, and it costs no machinery.
        onRetry={inviteProblem.retryable ? () => window.location.reload() : null}
        onContinue={onContinueWithoutInvite}
      />
    );
  }

  if (identityCheck) {
    return (
      <ApplyIdentityCheckScreen
        companyName={companyName}
        busy={identityCheck.busy}
        error={identityCheck.error}
        onConfirm={onConfirmIdentity}
        // The same handler the link-problem screen uses: dismiss the outcome and
        // fall through to the chooser, as an explicit press.
        onStartFresh={onContinueWithoutInvite}
      />
    );
  }

  if (!intakeMode) {
    return (
      <IntakeChooser
        companyName={companyName}
        onChooseAutoFill={handleChooseAutoFill}
        onChooseManual={handleChooseManual}
        cdlInputRef={cdlAutoFillInputRef}
        onCdlFileChange={handleCdlAutoFillFileChange}
      />
    );
  }

  // Shown when every direct submit attempt failed but the data is queued.
  if (submissionStatus === 'queued') return <SubmissionQueuedScreen onGoHome={onGoHome} />;

  return null;
}
