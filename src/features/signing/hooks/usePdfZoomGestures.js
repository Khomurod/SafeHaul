import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
    SIGNER_ZOOM_MIN,
    SIGNER_ZOOM_MAX,
    SIGNER_ZOOM_STEP,
    clampSignerZoom,
    computePinchZoom,
    computeZoomScrollOffsets,
    touchDistance,
    touchMidpoint,
} from '@features/signing/utils/envelopePdfZoom';

/**
 * Pinch-to-zoom + pan for the document-first signing room.
 *
 * Strategy: panning is native scrolling (the scroller has overflow:auto and
 * touch-action: pan-x pan-y, so one-finger pan stays on the fast browser
 * path). A two-finger pinch is intercepted with non-passive touch listeners:
 *
 *  - DURING the gesture we apply a transient CSS transform to the content
 *    wrapper (direct style mutation — no React re-renders at 60fps). Scaled
 *    canvas is slightly blurry mid-gesture, which is expected and brief.
 *  - ON RELEASE we commit: the PDF re-renders crisply at fitWidth × zoom and
 *    the scroll position is compensated so the document point under the
 *    fingers stays put. Field overlays are percent-positioned children of the
 *    page container, so they re-anchor automatically — taps after zoom use
 *    native DOM hit testing with zero coordinate math.
 */
export function usePdfZoomGestures({ minZoom = SIGNER_ZOOM_MIN, maxZoom = SIGNER_ZOOM_MAX } = {}) {
    const [zoom, setZoom] = useState(1);
    // Callback-ref state: the scroller mounts conditionally (after consent),
    // so a plain useRef + mount-time effect would never see it.
    const [scrollerEl, setScrollerEl] = useState(null);
    const contentRef = useRef(null);

    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;

    // Live gesture bookkeeping (refs only — never re-render mid-gesture).
    const gestureRef = useRef(null);
    const rafRef = useRef(0);
    // Scroll offsets to apply after React commits the new rendered width.
    const pendingScrollRef = useRef(null);

    /**
     * The page stack's offset inside the scrollable area (gutter padding +
     * centering margin). It does not scale with zoom, so the commit math must
     * exclude it. Requires the scroller to be position:relative so
     * offsetLeft/Top resolve against it.
     */
    const getContentOffsets = useCallback(() => {
        const content = contentRef.current;
        return {
            x: content ? content.offsetLeft : 0,
            y: content ? content.offsetTop : 0,
        };
    }, []);

    /** Commit a zoom change, keeping the content point at (midX, midY) fixed on screen. */
    const commitZoom = useCallback((nextZoom, midX, midY, { scrollLeft, scrollTop, endMidX, endMidY } = {}) => {
        const el = scrollerEl;
        const clamped = clampSignerZoom(nextZoom, minZoom, maxZoom);
        if (!el || clamped === zoomRef.current) return;
        const offsets = getContentOffsets();
        pendingScrollRef.current = computeZoomScrollOffsets({
            scrollLeft: scrollLeft ?? el.scrollLeft,
            scrollTop: scrollTop ?? el.scrollTop,
            startMidX: midX,
            startMidY: midY,
            endMidX: endMidX ?? midX,
            endMidY: endMidY ?? midY,
            oldZoom: zoomRef.current,
            newZoom: clamped,
            contentOffsetX: offsets.x,
            contentOffsetY: offsets.y,
        });
        setZoom(clamped);
    }, [scrollerEl, minZoom, maxZoom, getContentOffsets]);

    // Apply the compensated scroll in the same frame the new width lays out.
    // Page wrappers carry explicit width/height, so layout is correct here even
    // while the PDF canvases are still re-rendering asynchronously.
    useLayoutEffect(() => {
        if (!scrollerEl || !pendingScrollRef.current) return;
        const { scrollLeft, scrollTop } = pendingScrollRef.current;
        pendingScrollRef.current = null;
        scrollerEl.scrollLeft = scrollLeft;
        scrollerEl.scrollTop = scrollTop;
    }, [zoom, scrollerEl]);

    /** Button zoom: anchor on the center of the visible area. */
    const zoomBy = useCallback((delta) => {
        if (!scrollerEl) return;
        const midX = scrollerEl.clientWidth / 2;
        const midY = scrollerEl.clientHeight / 2;
        commitZoom(zoomRef.current + delta, midX, midY);
    }, [scrollerEl, commitZoom]);

    const zoomIn = useCallback(() => zoomBy(SIGNER_ZOOM_STEP), [zoomBy]);
    const zoomOut = useCallback(() => zoomBy(-SIGNER_ZOOM_STEP), [zoomBy]);
    const resetZoom = useCallback(() => {
        if (!scrollerEl) return;
        commitZoom(minZoom, scrollerEl.clientWidth / 2, scrollerEl.clientHeight / 2);
    }, [scrollerEl, commitZoom, minZoom]);

    /**
     * Programmatic zoom centered on a specific element (used when focusing a
     * field that is too small to read/type into at the current zoom).
     */
    const zoomToElement = useCallback((el, targetZoom) => {
        if (!scrollerEl || !el) return;
        const sRect = scrollerEl.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const midX = rect.left + rect.width / 2 - sRect.left;
        const midY = rect.top + rect.height / 2 - sRect.top;
        commitZoom(targetZoom, midX, midY);
    }, [scrollerEl, commitZoom]);

    // Touch listeners. React attaches passive touch handlers, so we must wire
    // these natively with { passive: false } to be allowed to preventDefault
    // (without it the browser pans/zooms the page underneath the pinch).
    useLayoutEffect(() => {
        const el = scrollerEl;
        if (!el) return undefined;

        const getContent = () => contentRef.current;

        const onTouchStart = (e) => {
            if (e.touches.length !== 2) return;
            const sRect = el.getBoundingClientRect();
            const mid = touchMidpoint(e.touches[0], e.touches[1]);
            const midX = mid.x - sRect.left;
            const midY = mid.y - sRect.top;
            gestureRef.current = {
                startDistance: touchDistance(e.touches[0], e.touches[1]),
                startZoom: zoomRef.current,
                startMidX: midX,
                startMidY: midY,
                endMidX: midX,
                endMidY: midY,
                scrollLeft: el.scrollLeft,
                scrollTop: el.scrollTop,
                currentZoom: zoomRef.current,
            };
            const content = getContent();
            if (content) {
                // Transform around the page-stack point under the fingers.
                // transform-origin is in the content element's local space, so
                // subtract its offset (gutter + centering) within the scroller.
                const originX = el.scrollLeft + midX - content.offsetLeft;
                const originY = el.scrollTop + midY - content.offsetTop;
                content.style.transformOrigin = `${originX}px ${originY}px`;
                content.style.willChange = 'transform';
            }
        };

        const onTouchMove = (e) => {
            const g = gestureRef.current;
            if (!g || e.touches.length < 2) return;
            e.preventDefault(); // keep the browser from scrolling/zooming mid-pinch
            const sRect = el.getBoundingClientRect();
            const mid = touchMidpoint(e.touches[0], e.touches[1]);
            g.endMidX = mid.x - sRect.left;
            g.endMidY = mid.y - sRect.top;
            g.currentZoom = computePinchZoom({
                startZoom: g.startZoom,
                startDistance: g.startDistance,
                currentDistance: touchDistance(e.touches[0], e.touches[1]),
                min: minZoom,
                max: maxZoom,
            });
            if (rafRef.current) return; // throttle style writes to one per frame
            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = 0;
                const live = gestureRef.current;
                const content = getContent();
                if (!live || !content) return;
                const scale = live.currentZoom / live.startZoom;
                const dx = live.endMidX - live.startMidX;
                const dy = live.endMidY - live.startMidY;
                content.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
            });
        };

        const endGesture = (e) => {
            const g = gestureRef.current;
            if (!g) return;
            if (e.touches.length >= 2) return; // still pinching with other fingers
            gestureRef.current = null;
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = 0;
            }
            const content = getContent();
            if (content) {
                content.style.transform = '';
                content.style.willChange = '';
            }
            commitZoom(g.currentZoom, g.startMidX, g.startMidY, {
                scrollLeft: g.scrollLeft,
                scrollTop: g.scrollTop,
                endMidX: g.endMidX,
                endMidY: g.endMidY,
            });
        };

        // iOS Safari fires proprietary gesture* events for pinch; preventing
        // them stops Safari from zooming the page itself under our handler.
        const preventNativeGesture = (e) => e.preventDefault();

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', endGesture, { passive: true });
        el.addEventListener('touchcancel', endGesture, { passive: true });
        el.addEventListener('gesturestart', preventNativeGesture);
        el.addEventListener('gesturechange', preventNativeGesture);

        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', endGesture);
            el.removeEventListener('touchcancel', endGesture);
            el.removeEventListener('gesturestart', preventNativeGesture);
            el.removeEventListener('gesturechange', preventNativeGesture);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [scrollerEl, commitZoom, minZoom, maxZoom]);

    return {
        zoom,
        zoomIn,
        zoomOut,
        resetZoom,
        zoomToElement,
        setScrollerEl, // attach to the overflow:auto scroll container
        scrollerEl,
        contentRef, // attach to the page-stack wrapper (transient transform target)
    };
}

export default usePdfZoomGestures;
