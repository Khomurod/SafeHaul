// The signing room's document viewport, kept apart from `SigningRoom.jsx` for
// the source-size standard. Everything about *showing* the PDF
// lives here: the pdf.js wiring and worker setup, per-page aspect tracking,
// the painted-page gate that keeps overlays inert on slow connections, the
// load-error/retry state, and the fit-width math. The room keeps the signer
// interaction handlers (change/focus/advance/signature) and passes them down,
// along with `pageRefs`, which its scroll-to-field navigation reads.
import React, { useState, useEffect, useRef } from 'react';
import { E2E_MOCK_PDF_URL } from '@features/signing/hooks/useSigningEnvelope';
import { SignerField } from '@features/signing/components/signing-room/SignerField';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { Button } from '@/design-system/components';
import { ErrorState } from '@design-system/patterns';
import { Document, Page } from 'react-pdf';
import '@lib/pdf/pdfWorker';
import { Icon, Loader2, AlertTriangle, RefreshCw } from '@design-system/icons';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// US Letter portrait ratio — used for page placeholders until the real page
// geometry arrives from pdf.js, so layout never jumps more than once.
const DEFAULT_PAGE_ASPECT = 1.294;

// Cap the fit-width on large screens for readability; zoom can exceed it.
const MAX_FIT_WIDTH = 800;
const MIN_FIT_WIDTH = 260;

// A page canvas on a phone takes megabytes. The first pages paint at once; the
// others paint as they come within this margin of the view, and give their
// canvas up when they leave it. Every page keeps its size and its fields.
const EAGER_PAGES = 2;
const PAGE_PAINT_MARGIN = '150% 0px';

export function SigningDocumentView({
    request,
    orderedFields,
    fieldValues,
    zoom,
    isMobile,
    scrollerEl,
    contentRef,
    pageRefs,
    handleFieldChange,
    handleFieldFocus,
    handleEnterAdvance,
    handleSignatureTap,
}) {
    const [numPages, setNumPages] = useState(null);

    // Document-rendering state for the unified (desktop + mobile) PDF view.
    const [pageAspects, setPageAspects] = useState({});
    // NET-SLOW FIX: Fields stay non-interactive per page until that page's
    // canvas has actually painted, so signers on throttled connections can't
    // fill boxes floating over a blank page.
    const [renderedPages, setRenderedPages] = useState(() => new Set());
    // Pages within `PAGE_PAINT_MARGIN` of the view; the first `EAGER_PAGES` paint regardless.
    const [nearPages, setNearPages] = useState(() => new Set());
    // The document whose page shapes are being read, so a late reading of one
    // document cannot land on the next.
    const measuredDoc = useRef(null);
    const [docError, setDocError] = useState(null);
    const [docReloadKey, setDocReloadKey] = useState(0);
    const [scrollerWidth, setScrollerWidth] = useState(() => window.innerWidth);

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
        setNearPages(new Set());
        measuredDoc.current = null;
        if (request?.pdfUrl === E2E_MOCK_PDF_URL) {
            setNumPages(1);
            setRenderedPages(new Set([1])); // mock shell has no real canvas to wait for
        } else {
            setNumPages(null);
            setRenderedPages(new Set());
        }
        setDocError(null);
    }, [request?.pdfUrl]);

    // Watch every page against the scroller, a margin beyond what is visible.
    // Without IntersectionObserver, every page paints, as before.
    useEffect(() => {
        if (!numPages || isE2EMockShell) return undefined;
        if (typeof IntersectionObserver !== 'function') {
            setNearPages(new Set(Array.from({ length: numPages }, (_, i) => i + 1)));
            return undefined;
        }
        const observer = new IntersectionObserver((entries) => {
            const entered = [];
            const left = [];
            for (const entry of entries) {
                const pageNumber = Number(entry.target?.dataset?.signingPage);
                if (pageNumber) (entry.isIntersecting ? entered : left).push(pageNumber);
            }
            setNearPages((prev) => {
                const next = new Set(prev);
                entered.forEach((n) => next.add(n));
                left.forEach((n) => next.delete(n));
                return next;
            });
            // A page that gave its canvas up paints again before its fields wake.
            const unpainted = left.filter((n) => n > EAGER_PAGES);
            if (unpainted.length > 0) {
                setRenderedPages((prev) => {
                    if (!unpainted.some((n) => prev.has(n))) return prev;
                    const next = new Set(prev);
                    unpainted.forEach((n) => next.delete(n));
                    return next;
                });
            }
        }, { root: scrollerEl || null, rootMargin: PAGE_PAINT_MARGIN });
        for (let n = 1; n <= numPages; n += 1) {
            const node = pageRefs.current[n];
            if (node) observer.observe(node);
        }
        return () => observer.disconnect();
    }, [numPages, scrollerEl, pageRefs, isE2EMockShell]);

    // Every page's shape, read from the document once it loads (no canvas), so
    // a page not yet painted keeps its real size and its fields their place.
    const handleDocumentLoad = async (pdf) => {
        setNumPages(pdf.numPages);
        if (typeof pdf?.getPage !== 'function') return;
        measuredDoc.current = pdf;
        const shapes = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
            try {
                const viewport = (await pdf.getPage(index + 1)).getViewport({ scale: 1 });
                return [index + 1, viewport.height / viewport.width];
            } catch {
                return null; // keep the default Letter aspect
            }
        }));
        if (measuredDoc.current !== pdf) return;
        setPageAspects((prev) => ({ ...prev, ...Object.fromEntries(shapes.filter(Boolean)) }));
    };

    const paintsPage = (pageNumber) => pageNumber <= EAGER_PAGES || nearPages.has(pageNumber);
    // A field that takes the keyboard focus paints its page at once, whatever
    // the observer has seen yet.
    const paintOnFocus = (pageNumber) => () => {
        setNearPages((prev) => (prev.has(pageNumber) ? prev : new Set(prev).add(pageNumber)));
    };

    const gutterX = isMobile ? 16 : 40; // matches px-2 / md:px-5 on the gutter wrapper
    const fitWidth = Math.max(MIN_FIT_WIDTH, Math.min(scrollerWidth - gutterX, MAX_FIT_WIDTH));
    const renderedWidth = Math.round(fitWidth * zoom);

    // Position in the signing order is passed down so every control gets a
    // uniquely distinguishing accessible name even when several fields share the
    // same author label (P1 from review on PR #112).
    const renderField = (field, ready) => (
        <SignerField
            field={field}
            ready={ready}
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
                    onFocus={paintOnFocus(pageNumber)}
                    className="relative border border-ds-border bg-ds-surface shadow-ds-lg"
                    // Explicit dimensions from the known aspect ratio keep layout
                    // (and overlay anchors) stable while canvases re-render after
                    // a zoom commit or rotation.
                    style={{ width: renderedWidth, height: Math.round(renderedWidth * aspect) }}
                >
                    {!isE2EMockShell && paintsPage(pageNumber) && (
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
                            <Icon icon={Loader2} size="lg" className="animate-spin" /> Rendering page {pageNumber}…
                        </div>
                    )}

                    {/* NET-SLOW FIX: keep overlays inert until the page has painted;
                        the fields still take focus, but no input (`ready`) */}
                    <div className={isPageReady ? undefined : 'pointer-events-none opacity-60'}>
                        {orderedFields
                            .filter((f) => Number(f?.pageNumber) === pageNumber)
                            .map((field) => (
                                <React.Fragment key={field.id}>{renderField(field, isPageReady)}</React.Fragment>
                            ))}
                    </div>
                </div>
            );
        });

    return docError ? (
        <div className="flex h-full items-center justify-center p-ds-6">
            {/* The approved page-state pattern, not a hand-composed Card +
                medallion + heading + retry. */}
            <div className="w-full max-w-sm">
                <ErrorState
                    icon={AlertTriangle}
                    title="Couldn't load the document"
                    description="Check your connection and try again. Your entered values are saved on this device."
                    actions={(
                        <Button
                            variant="primary"
                            onClick={() => {
                                setDocError(null);
                                setNumPages(null);
                                setRenderedPages(new Set());
                                setDocReloadKey((k) => k + 1);
                            }}
                        >
                            <Icon icon={RefreshCw} /> Try again
                        </Button>
                    )}
                />
            </div>
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
                        onLoadSuccess={handleDocumentLoad}
                        onLoadError={(err) => {
                            console.error('PDF load error:', err);
                            setDocError(err?.message || 'load_failed');
                        }}
                        loading={(
                            <div role="status" className="flex items-center gap-ds-2 py-16 text-ds-content-secondary">
                                <Icon icon={Loader2} size="xl" className="animate-spin" /> Loading document…
                            </div>
                        )}
                        className="flex flex-col items-center gap-4 md:gap-6"
                    >
                        {renderSigningPages()}
                    </Document>
                )}
            </div>
        </div>
    );
}
