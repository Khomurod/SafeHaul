import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';
import { Sparkles } from 'lucide-react';

/** Rendered width of a thumbnail, in px. Small on purpose — see below. */
const THUMBNAIL_WIDTH = 96;

/**
 * Page navigator.
 *
 * PERFORMANCE: a 60-page packet must not rasterise 60 full-resolution pages on
 * mount. Two things prevent that — each thumbnail renders at 96 px wide rather
 * than the canvas width, and a page is only handed to react-pdf once its slot
 * has scrolled near the viewport. Until then the slot is a cheap placeholder of
 * the same size, so the rail never reflows as pages arrive.
 *
 * Each entry states its page number and field count as text, and the current
 * page is marked with `aria-current` — never by the highlight alone.
 */
export function PageThumbnailRail({
    file,
    numPages = 0,
    activePage = 1,
    onSelectPage,
    fieldCountsByPage = {},
    suggestionCountsByPage = {},
    reviewPages = [],
    // 'rail' is the desktop column; 'sheet' is the compact page navigator, which
    // is already inside a labelled dialog and lays its pages out in a grid.
    variant = 'rail',
}) {
    const rawId = useId().replace(/:/g, '');
    const headingId = `page-rail-heading-${rawId}`;
    const total = Math.max(0, Number(numPages) || 0);

    const [visiblePages, setVisiblePages] = useState(() => new Set());
    const slotRefs = useRef({});
    const containerRef = useRef(null);

    const registerSlot = useCallback((page, node) => {
        if (node) slotRefs.current[page] = node;
        else delete slotRefs.current[page];
    }, []);

    useEffect(() => {
        if (total === 0) return undefined;

        // jsdom and older browsers have no IntersectionObserver. Rendering
        // everything there is fine — tests and fallbacks are not the case this
        // optimisation exists for.
        if (typeof IntersectionObserver !== 'function') {
            setVisiblePages(new Set(Array.from({ length: total }, (_, index) => index + 1)));
            return undefined;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const arrived = [];
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const page = Number(entry.target.dataset.thumbPage);
                    if (page) arrived.push(page);
                }
                if (arrived.length === 0) return;
                setVisiblePages((previous) => {
                    const next = new Set(previous);
                    for (const page of arrived) next.add(page);
                    return next;
                });
            },
            // Start rendering a screen early so scrolling does not show gaps.
            { root: containerRef.current, rootMargin: '400px 0px' },
        );

        for (const node of Object.values(slotRefs.current)) {
            if (node) observer.observe(node);
        }
        return () => observer.disconnect();
    }, [total]);

    // Keep the current page in view when it changes from the canvas.
    useEffect(() => {
        const node = slotRefs.current[activePage];
        if (node?.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
    }, [activePage]);

    if (total === 0 || !file) return null;

    return (
        <nav
            ref={containerRef}
            aria-labelledby={headingId}
            className={
                variant === 'sheet'
                    ? 'w-full overflow-y-auto p-ds-3'
                    : 'hidden w-28 shrink-0 overflow-y-auto border-r border-ds-border bg-ds-surface-subtle p-ds-2 lg:block'
            }
        >
            <h2
                id={headingId}
                className={`mb-ds-2 px-ds-1 text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary ${
                    variant === 'sheet' ? 'ds-visually-hidden' : ''
                }`}
            >
                Pages
            </h2>
            {/* The rail owns its own Document: react-pdf's `Page` needs one in
                context, and the canvas's Document is a separate subtree. */}
            <Document file={file} loading="" error="" noData="">
            <ul className={variant === 'sheet' ? 'grid grid-cols-3 gap-ds-2 sm:grid-cols-4' : 'flex flex-col gap-ds-2'}>
                {Array.from({ length: total }, (_, index) => index + 1).map((page) => {
                    const isCurrent = page === activePage;
                    const fieldCount = fieldCountsByPage[page] || 0;
                    const suggestionCount = suggestionCountsByPage[page] || 0;
                    const needsReview = reviewPages.includes(page);
                    // The current page and its neighbours always render, so the
                    // navigator is never blank while the observer catches up —
                    // and stays useful in environments where it never fires.
                    const shouldRender = visiblePages.has(page) || Math.abs(page - activePage) <= 1;

                    return (
                        <li key={page}>
                            <button
                                type="button"
                                ref={(node) => registerSlot(page, node)}
                                data-thumb-page={page}
                                aria-current={isCurrent ? 'page' : undefined}
                                aria-label={`Page ${page}, ${fieldCount} field${fieldCount === 1 ? '' : 's'}${
                                    suggestionCount > 0 ? `, ${suggestionCount} AI suggestion${suggestionCount === 1 ? '' : 's'}` : ''
                                }${needsReview ? ', needs manual review' : ''}`}
                                onClick={() => onSelectPage(page)}
                                className={`flex w-full flex-col items-center gap-ds-1 rounded-ds-lg border-2 p-ds-1 transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${
                                    isCurrent
                                        ? 'border-ds-action-primary bg-ds-status-info-bg'
                                        : 'border-ds-border-subtle bg-ds-surface hover:border-ds-border'
                                }`}
                            >
                                <span
                                    aria-hidden="true"
                                    className="flex w-full items-center justify-center overflow-hidden rounded-ds-sm bg-ds-surface"
                                    style={{ minHeight: THUMBNAIL_WIDTH * 1.29 }}
                                >
                                    {shouldRender ? (
                                        <Page
                                            pageNumber={page}
                                            width={THUMBNAIL_WIDTH}
                                            renderAnnotationLayer={false}
                                            renderTextLayer={false}
                                            loading=""
                                        />
                                    ) : null}
                                </span>

                                <span aria-hidden="true" className="flex w-full items-center justify-center gap-ds-1 text-ds-xs">
                                    <span className={isCurrent ? 'font-bold text-ds-status-info-fg' : 'text-ds-content-secondary'}>
                                        {page}
                                    </span>
                                    {fieldCount > 0 && (
                                        <span className="rounded-ds-sm bg-ds-status-neutral-bg px-1 text-ds-content-secondary">
                                            {fieldCount}
                                        </span>
                                    )}
                                    {suggestionCount > 0 && (
                                        <span className="text-ds-status-accent-fg">
                                            <Sparkles size={10} />
                                        </span>
                                    )}
                                    {needsReview && <span className="text-ds-status-warning-fg">!</span>}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            </Document>
        </nav>
    );
}

export default PageThumbnailRail;
