import React, { useId } from 'react';
import {
    CheckCircle, AlertTriangle, ShieldCheck, FileText, Ban,
} from 'lucide-react';
import { Button, Card, StatusMedallion } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { ErrorState, LoadingState, PageState } from '@design-system/patterns';

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
 * **2026-08-25: the four status screens are the approved page-state pattern.**
 * They had been hand-composed `Card` + `StatusMedallion` + heading + body +
 * actions — which is what `PageState` is, built later and never applied here. The
 * cost was measured: across these four and the five in `PublicApplyScreens`, one
 * kind of screen had `heading-sm` and `heading-md` titles, default and `lg`
 * medallions, icons at 28/32/40/48px, and three different gaps under the
 * medallion. Five appearances for one thing. The pattern owns all of that now, so
 * the feature keeps the words, the tone, the icon and the actions — and the
 * screens cannot drift apart again.
 *
 * `EsignConsentScreen` deliberately stays hand-composed: it is a consent *form*
 * with a nested `<h2>` disclosure region, a bulleted legal notice and a two-way
 * decision, none of which a page state can hold. It is not one of the three
 * states, and forcing it into the pattern would mean weakening the pattern.
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
    const headingId = `signing-loading-${useId().replace(/:/g, '')}`;
    return (
        <StatusPage labelledBy={headingId}>
            {/* The live region is an inner element: `role="status"` is not a valid
                role for `<main>`, so the landmark and the announcement are split —
                which is why the state's heading needs an id for the landmark to
                point at. */}
            <LoadingState
                surface="bare"
                headingLevel={1}
                titleId={headingId}
                title="Loading secure document..."
            />
        </StatusPage>
    );
}

export function SigningErrorScreen({ error }) {
    const headingId = `signing-error-${useId().replace(/:/g, '')}`;
    return (
        <StatusPage labelledBy={headingId}>
            {/*
             * The width lives on a wrapper rather than on `className`. A page
             * state's `className` reaches the state element itself — that is how
             * `LoadingState` adds its spin class — while its remaining props reach
             * the `Card`. Constraining the surface is therefore the wrapper's job,
             * which is the same shape `ErrorBoundary` already uses.
             */}
            <div className="w-full max-w-md">
                <ErrorState
                    icon={AlertTriangle}
                    headingLevel={1}
                    titleId={headingId}
                    title="Access Denied"
                    /* A signing error can carry an unbroken URL or token. */
                    description={<span className="[overflow-wrap:anywhere]">{error}</span>}
                />
            </div>
        </StatusPage>
    );
}

// PHASE 4: Voided document hard-stop
export function SigningVoidedScreen() {
    const headingId = `signing-voided-${useId().replace(/:/g, '')}`;
    return (
        <StatusPage labelledBy={headingId}>
            <div className="w-full max-w-md">
                <ErrorState
                    icon={Ban}
                    headingLevel={1}
                    titleId={headingId}
                    title="Document Voided"
                    description="This document has been voided by the sender and is no longer accessible."
                    actions={(
                        <Button variant="ghost" onClick={() => window.close()}>
                            Close Window
                        </Button>
                    )}
                />
            </div>
        </StatusPage>
    );
}

export function SigningSuccessScreen({ recipientName, onReturnToDocuments }) {
    const headingId = `signing-success-${useId().replace(/:/g, '')}`;
    return (
        <StatusPage labelledBy={headingId}>
            {/* The entrance animation is on the wrapper, so the card surface
                animates with its content as it did before. */}
            <div className="w-full max-w-md motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-300">
                <PageState
                    tone="success"
                    icon={CheckCircle}
                    announce="polite"
                    headingLevel={1}
                    titleId={headingId}
                    title="Document Signed!"
                    description={(
                        <>
                            Thank you, <strong>{recipientName}</strong>. The document has been securely sealed and sent to the sender.
                        </>
                    )}
                    actions={onReturnToDocuments ? (
                        /* Stacked, not side by side: the primary action is the one
                           that continues the driver's list of required documents. */
                        <Stack gap="sm" className="w-full">
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
                />
            </div>
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
