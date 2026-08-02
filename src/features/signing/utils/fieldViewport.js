/**
 * Keyboard-aware "scroll the active field into view" for the signing room.
 *
 * On phones the virtual keyboard shrinks the *visual* viewport without
 * resizing the layout viewport, so `scrollIntoView({ block: 'center' })` can
 * happily center a field underneath the keyboard. We instead measure the
 * visible region via window.visualViewport (when available) and nudge the
 * document scroller just enough to place the field in a comfortable band.
 */

/**
 * Pure math: scroll delta needed to bring [fieldTop, fieldBottom] (client px)
 * into the band between headerOffset and ~55% of the visible viewport height.
 * Positive delta = scroll down. Returns 0 when already comfortably visible.
 */
export function computeScrollAdjustment({
    fieldTop,
    fieldBottom,
    viewportTop = 0,
    viewportHeight,
    headerOffset = 0,
}) {
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;

    const visibleTop = viewportTop + headerOffset;
    // Keep the field in the upper half so the keyboard (bottom ~45%) never covers it.
    const comfortBottom = viewportTop + viewportHeight * 0.55;

    if (fieldBottom > comfortBottom) {
        return fieldBottom - comfortBottom;
    }
    if (fieldTop < visibleTop) {
        return fieldTop - visibleTop; // negative → scroll up
    }
    return 0;
}

/**
 * DOM wrapper. Waits out the keyboard animation, then scrolls the document
 * scroller (the signing room's overflow container) by the computed delta.
 */
export function ensureFieldVisible(fieldEl, scrollerEl, { headerOffset = 64, delay = 300 } = {}) {
    if (!fieldEl || !scrollerEl) return;
    setTimeout(() => {
        if (!fieldEl.isConnected) return;
        const rect = fieldEl.getBoundingClientRect();
        const vv = typeof window !== 'undefined' ? window.visualViewport : null;
        const delta = computeScrollAdjustment({
            fieldTop: rect.top,
            fieldBottom: rect.bottom,
            viewportTop: vv ? vv.offsetTop : 0,
            viewportHeight: vv ? vv.height : window.innerHeight,
            headerOffset,
        });
        if (delta !== 0) {
            if (typeof scrollerEl.scrollBy === 'function') {
                scrollerEl.scrollBy({ top: delta, behavior: 'smooth' });
            } else {
                // Older engines / test DOMs without Element.scrollBy
                scrollerEl.scrollTop += delta;
            }
        }
    }, delay);
}
