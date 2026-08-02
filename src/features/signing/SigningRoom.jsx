import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
    markRequestSigned,
    readSigningReturnPath,
} from '@features/driver-app/components/application/postApplyDocsStorage';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { isFieldLocked } from '@features/signing/utils/prefillEngine';
import { useSigningEnvelope, E2E_MOCK_PDF_URL } from '@features/signing/hooks/useSigningEnvelope';
import {
    sortFieldsForFlow,
    isFieldComplete,
    findFirstIncompleteField,
    findNextField,
} from '@features/signing/utils/signerFieldFlow';
import { ensureFieldVisible } from '@features/signing/utils/fieldViewport';
import { clampSignerZoom } from '@features/signing/utils/envelopePdfZoom';
import { SignatureSheet } from '@features/signing/components/SignatureSheet';
import { SignerField } from '@features/signing/components/signing-room/SignerField';
import {
    SigningLoadingScreen,
    SigningErrorScreen,
    SigningVoidedScreen,
    SigningSuccessScreen,
    EsignConsentScreen,
} from '@features/signing/components/signing-room/StatusScreens';
import { writeDraft, clearDraft } from '@features/signing/utils/signingDraft';
import { usePdfZoomGestures } from '@features/signing/hooks/usePdfZoomGestures';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { useIsMobile } from '@shared/hooks';
import { useToast } from '@shared/components/feedback';
import { Button, Card, IconButton, StatusMedallion } from '@/design-system/components';
import { Document, Page, pdfjs } from 'react-pdf';
import {
    Loader2, CheckCircle, ChevronDown, AlertTriangle, ZoomIn, ZoomOut, RefreshCw,
} from 'lucide-react';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Fix: Use local worker to avoid CORS and 404s
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

// US Letter portrait ratio — used for page placeholders until the real page
// geometry arrives from pdf.js, so layout never jumps more than once.
const DEFAULT_PAGE_ASPECT = 1.294;

// Cap the fit-width on large screens for readability; zoom can exceed it.
const MAX_FIT_WIDTH = 800;
const MIN_FIT_WIDTH = 260;

// Focused fields smaller than this (CSS px) trigger an automatic zoom bump on
// touch devices — at fit-width on a phone, a 5%-height field is ~18px and
// unusable for typing. 2.5x cap keeps the bump from being disorienting.
const MIN_COMFORTABLE_FIELD_PX = 22;
const AUTO_ZOOM_MAX = 2.5;

// The 2-second highlight that marks the field a signer was just sent to. Named
// so the add and remove calls cannot drift apart, and tokenised so the flash
// matches the focus ring the rest of the app uses.
const FIELD_FLASH_CLASSES = ['ring-2', 'ring-ds-focus', 'ring-offset-2'];

// Draft storage lives in @features/signing/utils/signingDraft (extracted verbatim).

export default function SigningRoom() {
    const { companyId, requestId } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const accessToken = searchParams.get('token');
    const isMobile = useIsMobile();
    const { showError } = useToast();

    // Post-application flow: the apply page stores a return path for its own
    // requests before navigating here. Recruiter-sent documents have none, so
    // their success screen keeps the plain "Close Window" behavior.
    const postApplyReturnPath = readSigningReturnPath(companyId, requestId);

    // Envelope loading + field-value initialization (draft merge, locked-field
    // seeding, E2E mock) live in useSigningEnvelope.
    const { request, fieldValues, setFieldValues, loading, error } = useSigningEnvelope({
        companyId,
        requestId,
        accessToken,
    });
    const [numPages, setNumPages] = useState(null);

    // ESIGN-8 FIX: Track electronic consent before allowing signing.
    // UETA (15 U.S.C. Sec. 96) and ESIGN Act (15 U.S.C. Sec. 7001) require affirmative consent
    // to use electronic records/signatures. Without this screen, e-signatures may not be
    // legally enforceable in disputes.
    const [hasEsignConsent, setHasEsignConsent] = useState(false);
    // { fieldId, kind: 'signature' | 'initial' } while the drawing sheet is open
    const [activeSignature, setActiveSignature] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    // Document-rendering state for the unified (desktop + mobile) PDF view.
    const [pageAspects, setPageAspects] = useState({});
    // NET-SLOW FIX: Fields stay non-interactive per page until that page's
    // canvas has actually painted, so signers on throttled connections can't
    // fill boxes floating over a blank page.
    const [renderedPages, setRenderedPages] = useState(() => new Set());
    const [docError, setDocError] = useState(null);
    const [docReloadKey, setDocReloadKey] = useState(0);
    const [scrollerWidth, setScrollerWidth] = useState(() => window.innerWidth);

    // The signer draws once; later signature/initial fields are stamped with
    // the same ink in one tap (DocuSign-style "adopted signature").
    const adoptedInkRef = useRef({ signature: null, initial: null });

    // PROD-FIX: Refs for each page container, used for scroll-to-field navigation
    const pageRefs = useRef({});

    const {
        zoom,
        zoomIn,
        zoomOut,
        zoomToElement,
        setScrollerEl,
        scrollerEl,
        contentRef,
    } = usePdfZoomGestures();

    const isE2EMockShell =
        isE2ETestMode &&
        getE2EQueryParam('e2eSign', '') === 'mock' &&
        request?.pdfUrl === E2E_MOCK_PDF_URL;

    // Track the scroller's box (not the window) so rotation and split-screen
    // resizes re-fit the page instantly. ResizeObserver is guarded for older
    // engines / test DOMs and falls back to window resize events.
    useEffect(() => {
        if (!scrollerEl) return undefined;
        const update = () => setScrollerWidth(scrollerEl.clientWidth);
        update();
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(update);
            ro.observe(scrollerEl);
            return () => ro.disconnect();
        }
        window.addEventListener('resize', update);
        window.addEventListener('orientationchange', update);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('orientationchange', update);
        };
    }, [scrollerEl]);

    // RACE FIX: Reset per-document render state when pdfUrl changes to prevent
    // stale pages/aspects bleeding into a different document.
    useEffect(() => {
        setPageAspects({});
        if (request?.pdfUrl === E2E_MOCK_PDF_URL) {
            setNumPages(1);
            setRenderedPages(new Set([1])); // mock shell has no real canvas to wait for
        } else {
            setNumPages(null);
            setRenderedPages(new Set());
        }
        setDocError(null);
    }, [request?.pdfUrl]);

    const handleFieldChange = useCallback((id, value) => {
        setFieldValues(prev => {
            const next = { ...prev, [id]: value };
            if (companyId && requestId) {
                writeDraft(companyId, requestId, next);
            }
            return next;
        });
    }, [companyId, requestId]);

    // Reading-order list drives "next field" navigation, the progress chip,
    // and the keyboard Enter key — independent of authoring order in Firestore.
    const orderedFields = useMemo(
        () => sortFieldsForFlow(request?.fields),
        [request?.fields],
    );

    // PROD-FIX: Compute remaining required fields for the progress indicator
    const requiredFields = useMemo(
        () => orderedFields.filter(f => f.required && !isFieldLocked(f)),
        [orderedFields],
    );

    const completedCount = useMemo(
        () => requiredFields.filter(f => isFieldComplete(f, fieldValues[f.id])).length,
        [requiredFields, fieldValues],
    );

    const remainingCount = requiredFields.length - completedCount;

    const firstIncompleteField = useMemo(
        () => findFirstIncompleteField(orderedFields, fieldValues),
        [orderedFields, fieldValues],
    );

    const lockedRequiredMissing = useMemo(() => {
        return (request?.fields || []).filter((field) => {
            if (!field || !field.required || !isFieldLocked(field)) return false;
            return String(field.defaultValue || '').trim() === '';
        });
    }, [request?.fields]);

    // PROD-FIX: Scroll directly to a field overlay (not just its page) and
    // flash it so the signer can spot the box they still need to fill.
    const scrollToField = useCallback((field) => {
        if (!field) return;
        const overlayEl = scrollerEl?.querySelector(`[data-field-id="${field.id}"]`);
        const target = overlayEl || pageRefs.current[Number(field.pageNumber) || 1];
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        // Applied imperatively, which is why the slice 2 JSX sweep missed the
        // legacy `ring-blue-500` here. The flash now uses the focus-ring token.
        target.classList.add(...FIELD_FLASH_CLASSES);
        setTimeout(() => {
            target.classList.remove(...FIELD_FLASH_CLASSES);
        }, 2000);
    }, [scrollerEl]);

    /**
     * KEYBOARD FIX: When the virtual keyboard opens it covers the lower ~45%
     * of the screen without resizing the layout viewport. Nudge the document
     * scroller so the focused field sits in the visible band, and — on touch
     * screens — bump the zoom first when the field is too small to type into.
     */
    const handleFieldFocus = useCallback((e) => {
        const el = e.target;
        if (isMobile) {
            const rect = el.getBoundingClientRect();
            if (rect.height > 0 && rect.height < MIN_COMFORTABLE_FIELD_PX) {
                const target = clampSignerZoom(
                    Math.min(AUTO_ZOOM_MAX, zoom * (MIN_COMFORTABLE_FIELD_PX + 6) / rect.height),
                );
                if (target > zoom + 0.1) {
                    zoomToElement(el, target);
                }
            }
        }
        ensureFieldVisible(el, scrollerEl);
    }, [isMobile, zoom, zoomToElement, scrollerEl]);

    /** Keyboard "Next"/Enter advances to the next fillable field in reading order. */
    const handleEnterAdvance = useCallback((field) => (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const next = findNextField(orderedFields, field.id);
        if (!next) {
            e.target.blur();
            return;
        }
        const nextInput = scrollerEl?.querySelector(`[data-signer-input="${next.id}"]`);
        if (nextInput) {
            nextInput.focus(); // focus handler scrolls it into the visible band
        } else {
            scrollToField(next); // signature/checkbox — show the signer where it is
        }
    }, [orderedFields, scrollerEl, scrollToField]);

    /**
     * Signature fields: first tap opens the drawing sheet; once ink has been
     * adopted, tapping another signature/initial box stamps the same ink in
     * one tap. Tapping an already-signed box re-opens the sheet to redraw.
     */
    const handleSignatureTap = useCallback((field) => {
        const kind = field.type === 'initial' ? 'initial' : 'signature';
        const saved = adoptedInkRef.current[kind];
        if (saved && !fieldValues[field.id]) {
            handleFieldChange(field.id, saved);
            return;
        }
        setActiveSignature({ fieldId: field.id, kind });
    }, [fieldValues, handleFieldChange]);

    const handleAdoptInk = useCallback((dataUrl) => {
        if (!activeSignature) return;
        adoptedInkRef.current[activeSignature.kind] = dataUrl;
        handleFieldChange(activeSignature.fieldId, dataUrl);
        setActiveSignature(null);
    }, [activeSignature, handleFieldChange]);

    const handleFinishSigning = async () => {
        if (lockedRequiredMissing.length > 0) {
            showError(
                'This document has required locked fields with no value. Please ask the sender to correct and resend it.'
            );
            scrollToField(lockedRequiredMissing[0]);
            return;
        }

        // Validate
        // Locked fields are seeded from defaultValue in state so payloads match the UI; server also merges empty strings for locked fields.
        // SAFETY: Guard against null/undefined elements in the fields array from corrupted Firestore data.
        const missing = (request?.fields || []).filter(f => f && f.required && !isFieldLocked(f) && !fieldValues[f.id]);
        if (missing.length > 0) {
            showError(`Please complete all required fields. (${missing.length} remaining)`);
            // PROD-FIX: Auto-scroll to the first missing field so the signer can find it
            scrollToField(missing[0]);
            return;
        }

        setSubmitting(true);
        try {
            if (isE2ETestMode && getE2EQueryParam('e2eSign', '') === 'mock') {
                clearDraft(companyId, requestId);
                if (postApplyReturnPath) markRequestSigned(companyId, requestId);
                setSuccess(true);
                return;
            }

            // The server-side publicSigning.js overrides the IP from the actual request context.
            // We still send userAgent for browser fingerprinting in the audit trail.
            const auditData = {
                userAgent: navigator.userAgent,
                timestamp: new Date().toISOString()
            };

            const submitFn = httpsCallable(functions, 'submitPublicEnvelope');
            await submitFn({
                companyId,
                requestId,
                accessToken,
                fieldValues,
                auditData
            });

            clearDraft(companyId, requestId);
            // Post-application flow: record completion so the Required Documents
            // checklist marks this template as completed when the driver returns.
            if (postApplyReturnPath) markRequestSigned(companyId, requestId);
            setSuccess(true);
            // ESIGN-16 FIX: Confetti removed - document signing is a professional/legal act;
            // celebratory animations are inappropriate in regulated trucking compliance context.

        } catch (e) {
            console.error("Submission Error:", e);
            showError("Error saving document: " + e.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <SigningLoadingScreen />;

    if (error) return <SigningErrorScreen error={error} />;

    // PHASE 4: Voided document hard-stop
    if (request?.status === 'voided') return <SigningVoidedScreen />;

    if (success) {
        return (
            <SigningSuccessScreen
                recipientName={request.recipientName}
                onReturnToDocuments={
                    postApplyReturnPath ? () => navigate(postApplyReturnPath) : undefined
                }
            />
        );
    }

    // ESIGN-8 FIX: Electronic consent screen required before document access.
    // UETA Sec. 5(b) and ESIGN Act Sec. 101(c) mandate that signers affirmatively agree to
    // conduct business electronically before they can be bound by electronic signatures.
    // The consent must be presented BEFORE the document is displayed (not inline).
    if (!hasEsignConsent) return (
        <EsignConsentScreen title={request?.title} onAgree={() => setHasEsignConsent(true)} />
    );

    // ------------------------------------------------------------------
    // Unified document-first view (desktop AND mobile).
    //
    // The PDF is always the source of truth on screen: fields are rendered as
    // percent-positioned overlays INSIDE each page container, so they scale
    // with the page at every viewport size and zoom level, and taps resolve
    // through native DOM hit testing (no coordinate math to drift).
    // ------------------------------------------------------------------

    const gutterX = isMobile ? 16 : 40; // matches px-2 / md:px-5 on the gutter wrapper
    const fitWidth = Math.max(MIN_FIT_WIDTH, Math.min(scrollerWidth - gutterX, MAX_FIT_WIDTH));
    const renderedWidth = Math.round(fitWidth * zoom);
    const zoomLabel = `${Math.round(zoom * 100)}%`;

    // Position in the signing order is passed down so every control gets a
    // uniquely distinguishing accessible name even when several fields share the
    // same author label (P1 from review on PR #112).
    const renderField = (field) => (
        <SignerField
            field={field}
            fieldPosition={orderedFields.findIndex((f) => f.id === field.id) + 1}
            fieldTotal={orderedFields.length}
            signed={request.status === 'signed'}
            fieldValues={fieldValues}
            handleFieldChange={handleFieldChange}
            handleFieldFocus={handleFieldFocus}
            handleEnterAdvance={handleEnterAdvance}
            handleSignatureTap={handleSignatureTap}
        />
    );

    const renderSigningPages = () =>
        numPages > 0 &&
        Array.from(new Array(numPages), (el, index) => {
            const pageNumber = index + 1;
            const aspect = pageAspects[pageNumber] || DEFAULT_PAGE_ASPECT;
            const isPageReady = renderedPages.has(pageNumber);
            return (
                <div
                    key={pageNumber}
                    ref={(node) => { pageRefs.current[pageNumber] = node; }}
                    data-signing-page={pageNumber}
                    className="relative border border-ds-border bg-ds-surface shadow-ds-lg"
                    // Explicit dimensions from the known aspect ratio keep layout
                    // (and overlay anchors) stable while canvases re-render after
                    // a zoom commit or rotation.
                    style={{ width: renderedWidth, height: Math.round(renderedWidth * aspect) }}
                >
                    {!isE2EMockShell && (
                        <Page
                            pageNumber={pageNumber}
                            width={renderedWidth}
                            renderAnnotationLayer={false}
                            renderTextLayer={false}
                            loading={null}
                            onLoadSuccess={(page) => {
                                try {
                                    const vp = page.getViewport({ scale: 1 });
                                    const ratio = vp.height / vp.width;
                                    setPageAspects((prev) =>
                                        prev[pageNumber] === ratio ? prev : { ...prev, [pageNumber]: ratio },
                                    );
                                } catch {
                                    /* keep the default Letter aspect */
                                }
                            }}
                            onRenderSuccess={() => {
                                setRenderedPages((prev) => {
                                    if (prev.has(pageNumber)) return prev;
                                    const next = new Set(prev);
                                    next.add(pageNumber);
                                    return next;
                                });
                            }}
                        />
                    )}

                    {!isPageReady && (
                        <div role="status" className="absolute inset-0 flex items-center justify-center gap-ds-2 text-ds-sm text-ds-content-secondary">
                            <Loader2 className="animate-spin" size={18} aria-hidden="true" /> Rendering page {pageNumber}…
                        </div>
                    )}

                    {/* NET-SLOW FIX: keep overlays inert until the page has painted */}
                    <div className={isPageReady ? undefined : 'pointer-events-none opacity-60'}>
                        {orderedFields
                            .filter((f) => Number(f?.pageNumber) === pageNumber)
                            .map((field) => (
                                <React.Fragment key={field.id}>{renderField(field)}</React.Fragment>
                            ))}
                    </div>
                </div>
            );
        });

    // Progress is stated by text and an icon, never the chip colour alone, and the
    // remaining count is announced so a signer using a screen reader learns when
    // the document becomes submittable.
    const progressChip = requiredFields.length > 0 && (
        <p
            role="status"
            className={`flex items-center gap-ds-1 whitespace-nowrap rounded-ds-lg px-ds-3 py-ds-1 text-ds-xs font-bold ${
                remainingCount === 0
                    ? 'bg-ds-status-success-bg text-ds-status-success-fg'
                    : 'bg-ds-status-warning-bg text-ds-status-warning-fg'
            }`}
        >
            {remainingCount === 0 ? (
                <><CheckCircle size={14} aria-hidden="true" /> <span className="hidden sm:inline">All fields complete</span><span className="sm:hidden">Done</span></>
            ) : (
                <><AlertTriangle size={14} aria-hidden="true" /> {remainingCount} <span className="hidden sm:inline">field{remainingCount > 1 ? 's' : ''} remaining</span><span className="sm:hidden">left</span></>
            )}
        </p>
    );

    const zoomControls = (
        <div role="group" aria-label="Document zoom" className="flex items-center gap-ds-1 rounded-ds-lg bg-ds-surface-subtle p-ds-1">
            <IconButton label="Zoom out" variant="ghost" size="sm" onClick={zoomOut}>
                <ZoomOut size={18} aria-hidden="true" />
            </IconButton>
            <span className="w-11 text-center text-ds-xs font-bold tabular-nums text-ds-content-secondary" aria-live="polite">
                {zoomLabel}
            </span>
            <IconButton label="Zoom in" variant="ghost" size="sm" onClick={zoomIn}>
                <ZoomIn size={18} aria-hidden="true" />
            </IconButton>
        </div>
    );

    return (
        // 100dvh tracks the *dynamic* mobile viewport (URL bar collapse); the
        // h-screen class is the fallback where dvh is unsupported.
        <div className="flex h-screen flex-col bg-ds-canvas" style={{ height: '100dvh' }}>
            <header
                className="z-30 flex shrink-0 items-center justify-between gap-ds-2 bg-ds-surface px-ds-3 py-ds-2 shadow-ds-xs md:px-ds-4 md:py-ds-3"
                style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
            >
                <div className="min-w-0">
                    <h1 className="truncate text-ds-sm font-bold text-ds-content md:text-ds-body">{request?.title || 'Document'}</h1>
                    <p className="truncate text-ds-xs text-ds-content-secondary">Signing as: {request?.recipientName || 'Signer'}</p>
                </div>

                <div className="flex shrink-0 items-center gap-ds-2 md:gap-ds-3">
                    {progressChip}
                    <div className="hidden md:block">{zoomControls}</div>
                    {/* The signer's primary action keeps its green identity through the
                        approved `tone="success"` capability. An earlier attempt overrode
                        the background with a utility class, which lost to Button's own
                        `[data-variant]` rule and left the control blue (P2 in review on
                        PR #114); the tone is now part of the primitive instead. */}
                    <Button
                        variant="primary"
                        tone="success"
                        className="hidden md:inline-flex"
                        loading={submitting}
                        onClick={handleFinishSigning}
                    >
                        {!submitting && <CheckCircle size={16} aria-hidden="true" />}
                        Finish &amp; Submit
                    </Button>
                </div>
            </header>

            {/* The document scroller: native one-finger pan on both axes; the
                gesture hook intercepts two-finger pinch. relative is required
                so the page stack's offsetLeft/Top resolve against it. */}
            <div
                ref={setScrollerEl}
                data-signing-scroller
                className="relative flex-1 overflow-auto overscroll-contain bg-ds-canvas"
                style={{ touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' }}
            >
                {docError ? (
                    <div className="flex h-full items-center justify-center p-ds-6">
                        <Card padding="lg" className="max-w-sm text-center" role="alert">
                            <StatusMedallion tone="danger" className="mx-auto mb-ds-3">
                                <AlertTriangle size={32} />
                            </StatusMedallion>
                            <h2 className="mb-ds-1 font-bold text-ds-content">Couldn&apos;t load the document</h2>
                            <p className="mb-ds-4 text-ds-sm text-ds-content-secondary">
                                Check your connection and try again. Your entered values are saved on this device.
                            </p>
                            <Button
                                variant="primary"
                                onClick={() => {
                                    setDocError(null);
                                    setNumPages(null);
                                    setRenderedPages(new Set());
                                    setDocReloadKey((k) => k + 1);
                                }}
                            >
                                <RefreshCw size={16} aria-hidden="true" /> Try again
                            </Button>
                        </Card>
                    </div>
                ) : (
                    <div className="px-2 py-4 md:px-5 md:py-8 pb-28 md:pb-8">
                        <div
                            ref={contentRef}
                            className="mx-auto flex flex-col items-center gap-4 md:gap-6"
                            style={{ width: renderedWidth }}
                        >
                            {isE2EMockShell ? (
                                renderSigningPages()
                            ) : (
                                <Document
                                    key={docReloadKey}
                                    file={request.pdfUrl}
                                    onLoadSuccess={({ numPages: pages }) => setNumPages(pages)}
                                    onLoadError={(err) => {
                                        console.error('PDF load error:', err);
                                        setDocError(err?.message || 'load_failed');
                                    }}
                                    loading={(
                                        <div role="status" className="flex items-center gap-ds-2 py-16 text-ds-content-secondary">
                                            <Loader2 className="animate-spin" size={20} aria-hidden="true" /> Loading document…
                                        </div>
                                    )}
                                    className="flex flex-col items-center gap-4 md:gap-6"
                                >
                                    {renderSigningPages()}
                                </Document>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Desktop keeps the floating jump pill; mobile gets a fixed action
                bar with zoom + next/finish (thumb-reachable, above safe area). */}
            {firstIncompleteField && (
                <div className="hidden md:block fixed bottom-6 right-6 z-40">
                    <Button
                        variant="primary"
                        className="shadow-ds-lg motion-safe:animate-bounce"
                        onClick={() => scrollToField(firstIncompleteField)}
                    >
                        <ChevronDown size={18} aria-hidden="true" />
                        Jump to next field (Page {Number(firstIncompleteField.pageNumber) || 1})
                    </Button>
                </div>
            )}

            <div
                className="z-40 flex shrink-0 items-center gap-ds-2 border-t border-ds-border bg-ds-surface px-ds-3 py-ds-2 md:hidden"
                style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
            >
                {zoomControls}
                <div className="flex-1" />
                {remainingCount > 0 && firstIncompleteField ? (
                    <Button variant="primary" onClick={() => scrollToField(firstIncompleteField)}>
                        <ChevronDown size={16} aria-hidden="true" /> Next field
                    </Button>
                ) : (
                    /* Same approved success tone as the desktop CTA. */
                    <Button
                        variant="primary"
                        tone="success"
                        loading={submitting}
                        onClick={handleFinishSigning}
                    >
                        {!submitting && <CheckCircle size={16} aria-hidden="true" />}
                        Finish &amp; Submit
                    </Button>
                )}
            </div>

            {activeSignature && (
                <SignatureSheet
                    kind={activeSignature.kind}
                    onCancel={() => setActiveSignature(null)}
                    onAdopt={handleAdoptInk}
                />
            )}
        </div>
    );
}
