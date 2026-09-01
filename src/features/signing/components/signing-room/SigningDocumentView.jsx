// The signing room's document viewport, split out of `SigningRoom.jsx` on
// 2026-09-01 for the source-size standard. Everything about *showing* the PDF
// lives here: the pdf.js wiring and worker setup, per-page aspect tracking,
// the painted-page gate that keeps overlays inert on slow connections, the
// load-error/retry state, and the fit-width math. The room keeps the signer
// interaction handlers (change/focus/advance/signature) and passes them down,
// along with `pageRefs`, which its scroll-to-field navigation reads.
import React, { useState, useEffect } from 'react';
import { E2E_MOCK_PDF_URL } from '@features/signing/hooks/useSigningEnvelope';
import { SignerField } from '@features/signing/components/signing-room/SignerField';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { Button } from '@/design-system/components';
import { ErrorState } from '@design-system/patterns';
import { Document, Page, pdfjs } from 'react-pdf';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';

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
        if (request?.pdfUrl === E2E_MOCK_PDF_URL) {
            setNumPages(1);
            setRenderedPages(new Set([1])); // mock shell has no real canvas to wait for
        } else {
            setNumPages(null);
            setRenderedPages(new Set());
        }
        setDocError(null);
    }, [request?.pdfUrl]);

    const gutterX = isMobile ? 16 : 40; // matches px-2 / md:px-5 on the gutter wrapper
    const fitWidth = Math.max(MIN_FIT_WIDTH, Math.min(scrollerWidth - gutterX, MAX_FIT_WIDTH));
    const renderedWidth = Math.round(fitWidth * zoom);

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

    return docError ? (
        <div className="flex h-full items-center justify-center p-ds-6">
            {/* The approved page-state pattern since 2026-08-25; this was
                a hand-composed Card + medallion + heading + retry. */}
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
                            <RefreshCw size={16} aria-hidden="true" /> Try again
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
    );
}
