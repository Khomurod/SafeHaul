import React, { useId } from 'react';
import {
    Loader2, CheckCircle, AlertTriangle, ShieldCheck, FileText, Ban,
} from 'lucide-react';
import { Button, Card, StatusMedallion } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';

/**
 * Full-page status screens for the public signing room.
 *
 * Presentation only. Every user-facing string is frozen — several are asserted by
 * the signing E2E specs and the `@a11y` journey ("I Agree - Proceed to Sign",
 * "Document Signed!", "Return to Required Documents", "Close Window",
 * "Decline") — as is the `window.close()` behaviour behind every Close/Decline
 * control and the `onAgree` / `onReturnToDocuments` callbacks.
 *
 * The circular status disc is the approved `StatusMedallion`; this feature keeps
 * only the domain → tone/icon decision, not the shape or spacing.
 *
 * Accessibility: each screen is now a `<main>` landmark with a single `<h1>`, so
 * a signer landing on one hears what it is instead of an unlabelled page. The
 * loading screen announces itself via `role="status"`, and the error, voided and
 * consent screens use `role="alert"`/`role="status"` as appropriate. Every
 * control is an approved `Button`; the previous bare `<button>`s styled as text
 * links had no accessible affordance beyond hover.
 */

/** Shared centred page shell so all six screens share one layout contract. */
function StatusPage({ children, labelledBy }) {
    return (
        <main
            aria-labelledby={labelledBy}
            className="flex h-screen items-center justify-center bg-ds-canvas p-ds-4"
        >
            {children}
        </main>
    );
}

export function SigningLoadingScreen() {
    return (
        <main className="flex h-screen items-center justify-center bg-ds-canvas">
            {/* The live region is an inner element: `role="status"` is not a valid
                role for `<main>`, so the landmark and the announcement are split. */}
            <div role="status" className="flex items-center gap-ds-3">
                <Loader2 className="animate-spin text-ds-action-primary" size={40} aria-hidden="true" />
                <p className="font-medium text-ds-content-secondary">Loading secure document...</p>
            </div>
        </main>
    );
}

export function SigningErrorScreen({ error }) {
    const headingId = `signing-error-${useId().replace(/:/g, '')}`;
    return (
        <StatusPage labelledBy={headingId}>
            <Card padding="lg" className="max-w-md text-center" role="alert">
                <StatusMedallion tone="danger" className="mx-auto mb-ds-4"><AlertTriangle size={32} /></StatusMedallion>
                <h1 id={headingId} className="mb-ds-2 text-ds-heading-sm font-bold text-ds-content">Access Denied</h1>
                <p className="text-ds-content-secondary [overflow-wrap:anywhere]">{error}</p>
            </Card>
        </StatusPage>
    );
}

// PHASE 4: Voided document hard-stop
export function SigningVoidedScreen() {
    const headingId = `signing-voided-${useId().replace(/:/g, '')}`;
    return (
        <StatusPage labelledBy={headingId}>
            <Card padding="lg" className="max-w-md text-center" role="alert">
                <StatusMedallion tone="danger" size="lg" className="mx-auto mb-ds-6"><Ban size={48} /></StatusMedallion>
                <h1 id={headingId} className="mb-ds-2 text-ds-heading-md font-bold text-ds-content">Document Voided</h1>
                <p className="mb-ds-6 text-ds-content-secondary">
                    This document has been voided by the sender and is no longer accessible.
                </p>
                <Button variant="ghost" onClick={() => window.close()}>
                    Close Window
                </Button>
            </Card>
        </StatusPage>
    );
}

export function SigningSuccessScreen({ recipientName, onReturnToDocuments }) {
    const headingId = `signing-success-${useId().replace(/:/g, '')}`;
    return (
        <StatusPage labelledBy={headingId}>
            <Card
                padding="lg"
                className="max-w-md text-center motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-300"
            >
                <StatusMedallion tone="success" size="lg" className="mx-auto mb-ds-6"><CheckCircle size={48} /></StatusMedallion>
                <h1 id={headingId} className="mb-ds-2 text-ds-heading-md font-bold text-ds-content">Document Signed!</h1>
                <p className="mb-ds-6 text-ds-content-secondary">
                    Thank you, <strong>{recipientName}</strong>. The document has been securely sealed and sent to the sender.
                </p>
                {onReturnToDocuments ? (
                    <Stack gap="sm">
                        <Button variant="primary" fullWidth onClick={onReturnToDocuments}>
                            Return to Required Documents
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => window.close()}>
                            Close Window
                        </Button>
                    </Stack>
                ) : (
                    <Button variant="ghost" onClick={() => window.close()}>
                        Close Window
                    </Button>
                )}
            </Card>
        </StatusPage>
    );
}

// ESIGN-8 FIX: Electronic consent screen required before document access.
// UETA Sec. 5(b) and ESIGN Act Sec. 101(c) mandate that signers affirmatively agree to
// conduct business electronically before they can be bound by electronic signatures.
// The consent must be presented BEFORE the document is displayed (not inline).
export function EsignConsentScreen({ title, onAgree }) {
    const rawId = useId().replace(/:/g, '');
    const headingId = `esign-consent-heading-${rawId}`;
    const disclosureId = `esign-consent-disclosure-${rawId}`;

    return (
        <StatusPage labelledBy={headingId}>
            <Card padding="lg" className="w-full max-w-lg">
                <div className="mb-ds-5 flex items-center gap-ds-3">
                    <StatusMedallion tone="info"><ShieldCheck size={28} /></StatusMedallion>
                    <div>
                        <h1 id={headingId} className="text-ds-heading-sm font-bold text-ds-content">
                            Electronic Signature Consent
                        </h1>
                        <p className="text-ds-sm text-ds-content-secondary">Required before signing</p>
                    </div>
                </div>

                <Stack gap="md" className="mb-ds-6 text-ds-sm text-ds-content">
                    <p>
                        You are about to electronically sign: <strong className="text-ds-content">{title || 'a document'}</strong>.
                    </p>
                    {/* The disclosure is a labelled region so a screen-reader user can
                        find and re-read the terms they are consenting to. */}
                    <section
                        aria-labelledby={disclosureId}
                        className="rounded-ds-lg border border-ds-status-info-border bg-ds-status-info-bg p-ds-4"
                    >
                        <h2 id={disclosureId} className="mb-ds-2 flex items-center gap-ds-2 font-semibold text-ds-status-info-fg">
                            <FileText size={16} aria-hidden="true" /> Electronic Records &amp; Signature Disclosure
                        </h2>
                        <ul className="list-inside list-disc space-y-1 text-ds-xs text-ds-status-info-fg">
                            <li>Your electronic signature is legally binding under the ESIGN Act (15 U.S.C. Sec. 7001) and UETA.</li>
                            <li>You agree to receive and sign this document electronically instead of on paper.</li>
                            <li>You may withdraw consent and request a paper copy by contacting the sender.</li>
                            <li>To sign electronically, you need a compatible web browser with JavaScript enabled.</li>
                            <li>Your IP address and browser information are recorded in the audit trail for this document.</li>
                        </ul>
                    </section>
                    <p className="text-ds-content-secondary">
                        By clicking <strong>&quot;I Agree - Proceed to Sign&quot;</strong>, you confirm that you have read and agree to use electronic records and signatures.
                    </p>
                </Stack>

                <div className="flex flex-col gap-ds-3 sm:flex-row">
                    <Button fullWidth onClick={() => window.close()}>
                        Decline
                    </Button>
                    <Button variant="primary" fullWidth onClick={onAgree}>
                        <ShieldCheck size={18} aria-hidden="true" />
                        I Agree - Proceed to Sign
                    </Button>
                </div>
            </Card>
        </StatusPage>
    );
}
