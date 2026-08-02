import React, { useEffect, useId, useRef } from 'react';
import { Loader2, AlertCircle, Building2 } from 'lucide-react';
import { Button, Card, StatusMedallion } from '@/design-system/components';
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
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-ds-canvas">
      {/* `role="status"` is not valid on `<main>`, so the landmark and the
          announcement are separate elements. */}
      <div role="status" className="flex flex-col items-center">
        <Loader2 className="mb-ds-4 animate-spin text-ds-action-primary" size={48} aria-hidden="true" />
        <p className="text-ds-body-lg font-semibold text-ds-content-secondary">Loading Application...</p>
      </div>
    </main>
  );
}

export function ApplyLinkErrorScreen({ error }) {
  const headingId = `apply-link-error-${useId().replace(/:/g, '')}`;
  return (
    <StatusPage labelledBy={headingId}>
      <Card padding="lg" className="max-w-md text-center" role="alert">
        <StatusMedallion tone="danger" className="mx-auto mb-ds-4"><AlertCircle size={32} /></StatusMedallion>
        <h1 id={headingId} className="mb-ds-2 text-ds-heading-sm font-bold text-ds-content">Link Error</h1>
        <p className="text-ds-content-secondary [overflow-wrap:anywhere]">{error}</p>
      </Card>
    </StatusPage>
  );
}

export function ParsingCdlScreen({ autoFillStoragePath }) {
  const headingId = `apply-parsing-cdl-${useId().replace(/:/g, '')}`;
  return (
    <StatusPage labelledBy={headingId}>
      <Card padding="lg" className="w-full max-w-md text-center" role="status">
        <StatusMedallion tone="info" size="lg" className="mx-auto mb-ds-4">
          <Loader2 className="animate-spin" size={30} />
        </StatusMedallion>
        <h1 id={headingId} className="mb-ds-2 text-ds-heading-md font-bold text-ds-content">Reading your CDL...</h1>
        <p className="mb-ds-3 text-ds-content-secondary">
          Our AI is extracting your basic details so you can skip typing.
        </p>
        {autoFillStoragePath && (
          <p className="text-ds-xs text-ds-content-muted [overflow-wrap:anywhere]">{autoFillStoragePath}</p>
        )}
      </Card>
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
  const headingRef = useRef(null);
  // The submit button that produced this screen is gone, so focus would sit on
  // `<body>`: a keyboard or screen-reader applicant would not be told the
  // application landed, nor that required documents are still outstanding.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
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
      <Card padding="lg" className="w-full max-w-md text-center">
        <StatusMedallion tone={hasPendingRequired ? 'info' : 'success'} size="lg" className="mx-auto mb-ds-6">
          <Building2 size={40} />
        </StatusMedallion>
        <h1
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="mb-ds-3 text-ds-heading-md font-bold text-ds-content focus-visible:shadow-ds-focus"
        >
          Application Submitted!
        </h1>
        <p className="mb-ds-4 text-ds-content-secondary">
          {hasPendingRequired
            ? 'Your application has been received. To finish, please complete the required documents below.'
            : 'Your application has been received and a recruiter will contact you soon.'}
        </p>
        {confirmNum && (
          <div className="mb-ds-6 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle px-ds-4 py-ds-3">
            <p className="mb-ds-1 text-ds-xs uppercase tracking-wide text-ds-content-secondary">Confirmation Number</p>
            <p className="font-mono text-ds-body-lg font-bold text-ds-content [overflow-wrap:anywhere]">{confirmNum}</p>
            <p className="mt-ds-1 text-ds-xs text-ds-content-secondary">Save this number for your records.</p>
          </div>
        )}
        {showChecklist && (
          <div className="mb-ds-4">
            <RequiredDocumentsChecklist
              templates={postApplicationTemplates}
              docStates={docStates}
              openingTemplateId={openingTemplateId}
              onOpenTemplate={handleOpenPostApplicationTemplate}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-ds-3">
          <Button variant="ghost" onClick={onGoHome}>Go to home</Button>
          {onStartNewApplication && (
            <Button variant="ghost" onClick={onStartNewApplication}>
              Start a new application
            </Button>
          )}
        </div>
      </Card>
    </StatusPage>
  );
}

// P3-3 FIX: Queued status UI — shown when all direct submit attempts failed but data is queued
export function SubmissionQueuedScreen({ onGoHome }) {
  const headingId = `apply-queued-${useId().replace(/:/g, '')}`;
  return (
    <StatusPage labelledBy={headingId}>
      <Card padding="lg" className="max-w-md text-center" role="status">
        <StatusMedallion tone="warning" size="lg" className="mx-auto mb-ds-6"><Building2 size={40} /></StatusMedallion>
        <h1 id={headingId} className="mb-ds-3 text-ds-heading-md font-bold text-ds-content">Application Saved</h1>
        <p className="mb-ds-4 text-ds-content-secondary">Your application has been securely saved and will be automatically submitted when your connection is restored.</p>
        <p className="mb-ds-6 text-ds-sm text-ds-content-muted">You can safely close this page. No data will be lost.</p>
        <Button variant="ghost" onClick={onGoHome}>Go to home</Button>
      </Card>
    </StatusPage>
  );
}
