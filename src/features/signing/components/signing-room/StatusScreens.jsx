import React, { useEffect, useId, useRef } from 'react';
import { Icon, CheckCircle, ShieldCheck, FileText, FileCheck, Ban } from '@design-system/icons';
import { Button, Card, StatusMedallion } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { ErrorState, LoadingState, PageState } from '@design-system/patterns';

/**
 * Full-page status screens for the public signing room.
 *
 * Presentation only. The strings the signing E2E specs and the `@a11y` journey
 * assert are frozen — "I Agree - Proceed to Sign", "Document Signed!", "Return to
 * Required Documents" — as are the `onAgree` / `onReturnToDocuments` callbacks.
 * A link that does not open is not one of these screens: the room shows the
 * public pages' shared `LinkProblemScreen`.
 *
 * **No control here tries to close the tab.** A browser lets a page close only a
 * window a script opened, never one opened from an email or a text, so "Close
 * Window" did nothing for exactly the signers who needed it. Where the visit
 * ends, the screen says "You can close this tab." instead.
 *
 * The circular status disc is the approved `StatusMedallion`; this feature keeps
 * only the domain → tone/icon decision, not the shape or spacing.
 *
 * **The status screens are the approved page-state pattern.** The pattern owns
 * the title size, the medallion, the icon size and the spacing, so the feature
 * keeps the words, the tone, the icon and the actions — and the screens cannot
 * drift apart.
 *
 * `EsignConsentScreen` deliberately stays hand-composed: it is a consent *form*
 * with a nested `<h2>` disclosure region, a bulleted legal notice and a two-way
 * decision, none of which a page state can hold. It is not one of the three
 * states, and forcing it into the pattern would mean weakening the pattern.
 *
 * Accessibility: each screen is a `<main>` landmark with a single `<h1>`, so a
 * signer landing on one hears what it is instead of an unlabelled page. The
 * loading screen announces itself via `role="status"`; the declined screen,
 * which replaces the button just pressed, moves focus to its heading. Every
 * control is an approved `Button`.
 */

const CLOSE_TAB = 'You can close this tab.';

/** Shared centred page shell so every screen shares one layout contract. */
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

// PHASE 4: Voided document hard-stop
export function SigningVoidedScreen() {
    const headingId = `signing-voided-${useId().replace(/:/g, '')}`;
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
                    icon={Ban}
                    headingLevel={1}
                    titleId={headingId}
                    title="Document Voided"
                    description={`This document has been voided by the sender and is no longer accessible. ${CLOSE_TAB}`}
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
                            {/* A driver's list of required documents goes on; anyone else is done. */}
                            {!onReturnToDocuments && ` ${CLOSE_TAB}`}
                        </>
                    )}
                    actions={onReturnToDocuments && (
                        <Button variant="primary" fullWidth onClick={onReturnToDocuments}>
                            Return to Required Documents
                        </Button>
                    )}
                />
            </div>
        </StatusPage>
    );
}

/**
 * The document behind this link is signed already: the server says so, or this
 * device signed it (`utils/alreadySigned.js`). Shown instead of the consent,
 * which would otherwise ask the signer to agree to sign it again.
 *
 * @param {object} props
 * @param {string} [props.signedAt] when it was signed, where the page knows
 * @param {() => void} [props.onReturnToDocuments] a driver's list of required documents
 */
export function SigningAlreadySignedScreen({ signedAt, onReturnToDocuments }) {
    const headingId = `signing-already-signed-${useId().replace(/:/g, '')}`;
    const signedOn = signedAt ? new Date(signedAt) : null;
    const when = signedOn && Number.isFinite(signedOn.getTime())
        ? ` It was signed on ${signedOn.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.`
        : '';
    return (
        <StatusPage labelledBy={headingId}>
            <div className="w-full max-w-md">
                <PageState
                    tone="success"
                    icon={FileCheck}
                    headingLevel={1}
                    titleId={headingId}
                    title="This document is already signed"
                    description={`There is nothing more to do here.${when}${onReturnToDocuments ? '' : ` ${CLOSE_TAB}`}`}
                    actions={onReturnToDocuments && (
                        <Button variant="primary" fullWidth onClick={onReturnToDocuments}>
                            Return to Required Documents
                        </Button>
                    )}
                />
            </div>
        </StatusPage>
    );
}

/**
 * The signer declined to sign electronically. Declining records nothing on the
 * server — it never did; it only tried to close the tab — so this says what is
 * true and how to sign on paper, which the disclosure promised. Go back reopens
 * the consent, for a press made by mistake.
 */
export function SigningDeclinedScreen({ onGoBack }) {
    const headingId = `signing-declined-${useId().replace(/:/g, '')}`;
    return (
        <StatusPage labelledBy={headingId}>
            <div className="w-full max-w-md">
                <PageState
                    tone="neutral"
                    icon={FileText}
                    headingLevel={1}
                    titleId={headingId}
                    focusOnMount
                    title="You did not agree to sign electronically"
                    description={`Nothing was signed. To sign on paper instead, contact the sender. ${CLOSE_TAB}`}
                    actions={<Button variant="secondary" onClick={onGoBack}>Go back</Button>}
                />
            </div>
        </StatusPage>
    );
}

// ESIGN-8 FIX: Electronic consent screen required before document access.
// UETA Sec. 5(b) and ESIGN Act Sec. 101(c) mandate that signers affirmatively agree to
// conduct business electronically before they can be bound by electronic signatures.
// The consent must be presented BEFORE the document is displayed (not inline).
export function EsignConsentScreen({ title, onAgree, onDecline, focusOnMount = false }) {
    const rawId = useId().replace(/:/g, '');
    const headingId = `esign-consent-heading-${rawId}`;
    const disclosureId = `esign-consent-disclosure-${rawId}`;
    // Shown again by Go back, it replaces the button just pressed: the heading
    // takes the focus so a keyboard or screen-reader user is not left on `<body>`.
    const headingRef = useRef(null);
    useEffect(() => {
        if (focusOnMount) headingRef.current?.focus();
    }, [focusOnMount]);

    return (
        <StatusPage labelledBy={headingId}>
            <Card padding="lg" className="w-full max-w-lg">
                <div className="mb-ds-5 flex items-center gap-ds-3">
                    <StatusMedallion tone="info"><Icon icon={ShieldCheck} /></StatusMedallion>
                    <div>
                        <h1
                            id={headingId}
                            ref={headingRef}
                            tabIndex={focusOnMount ? -1 : undefined}
                            className="text-ds-heading-sm font-bold text-ds-content"
                        >
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
                            <Icon icon={FileText} /> Electronic Records &amp; Signature Disclosure
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
                    <Button fullWidth onClick={onDecline}>
                        Decline
                    </Button>
                    <Button variant="primary" fullWidth onClick={onAgree}>
                        <Icon icon={ShieldCheck} size="lg" />
                        I Agree - Proceed to Sign
                    </Button>
                </div>
            </Card>
        </StatusPage>
    );
}
