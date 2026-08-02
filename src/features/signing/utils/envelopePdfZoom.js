/** Default PDF preview width in px (matches legacy EnvelopeCreator behavior). */
export const PDF_VIEWPORT_WIDTH_DEFAULT = 700;

export const PDF_VIEWPORT_WIDTH_MIN = 320;

export const PDF_VIEWPORT_WIDTH_MAX = 1400;

/** WheelEvent.deltaMode values */
export const DELTA_PIXEL = 0;
export const DELTA_LINE = 1;
export const DELTA_PAGE = 2;

export function clampPdfViewportWidth(width) {
  const n = Number(width);
  if (Number.isNaN(n)) return PDF_VIEWPORT_WIDTH_DEFAULT;
  return Math.min(PDF_VIEWPORT_WIDTH_MAX, Math.max(PDF_VIEWPORT_WIDTH_MIN, Math.round(n)));
}

/**
 * Ctrl/⌘ + wheel: map delta to next viewport width.
 * Positive deltaY (scroll down) → shrink preview (like browser zoom out).
 */
export function adjustPdfViewportWidth(current, deltaY, deltaMode = DELTA_PIXEL) {
  let factor = -0.65;
  if (deltaMode === DELTA_LINE) factor *= 14;
  if (deltaMode === DELTA_PAGE) factor *= 100;
  return clampPdfViewportWidth(current + Number(deltaY) * factor);
}

export function zoomPercentLabel(width, base = PDF_VIEWPORT_WIDTH_DEFAULT) {
  const b = base || PDF_VIEWPORT_WIDTH_DEFAULT;
  return Math.round((clampPdfViewportWidth(width) / b) * 100);
}

// ---------------------------------------------------------------------------
// Signer-side zoom (SigningRoom document-first view).
//
// Zoom is a *factor* relative to fit-width (1 = page fits the scroller). The
// committed zoom re-renders the PDF at `fitWidth * zoom`, so field overlays —
// which are percent-positioned children of the page container — stay anchored
// with no hit-testing math. These pure helpers carry the gesture math so the
// touch handlers stay thin and the coordinate behavior is unit-testable.
// ---------------------------------------------------------------------------

export const SIGNER_ZOOM_MIN = 1;
export const SIGNER_ZOOM_MAX = 4;
export const SIGNER_ZOOM_STEP = 0.5;

export function clampSignerZoom(zoom, min = SIGNER_ZOOM_MIN, max = SIGNER_ZOOM_MAX) {
  const n = Number(zoom);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Distance between two touch points (gesture spread). */
export function touchDistance(a, b) {
  return Math.hypot((b?.clientX ?? 0) - (a?.clientX ?? 0), (b?.clientY ?? 0) - (a?.clientY ?? 0));
}

/** Midpoint of two touch points in client coordinates. */
export function touchMidpoint(a, b) {
  return {
    x: ((a?.clientX ?? 0) + (b?.clientX ?? 0)) / 2,
    y: ((a?.clientY ?? 0) + (b?.clientY ?? 0)) / 2,
  };
}

/** New zoom factor for a pinch: spread ratio applied to the zoom at gesture start. */
export function computePinchZoom({ startZoom, startDistance, currentDistance, min, max }) {
  if (!startDistance || startDistance <= 0) return clampSignerZoom(startZoom, min, max);
  return clampSignerZoom(startZoom * (currentDistance / startDistance), min, max);
}

/**
 * Scroll offsets that keep the document point under the gesture midpoint
 * stationary when content is re-rendered from oldZoom to newZoom.
 *
 * The page stack sits inside a fixed gutter (contentOffsetX/Y) that does NOT
 * scale with zoom. The document point under the start midpoint is
 * (scroll + mid - offset) in page-stack px; after scaling by
 * f = newZoom / oldZoom it sits at f× that coordinate, and we want it under
 * the *end* midpoint (fingers may have panned while pinching). Offsets are
 * clamped at 0; the browser clamps the max side.
 */
export function computeZoomScrollOffsets({
  scrollLeft,
  scrollTop,
  startMidX,
  startMidY,
  endMidX = startMidX,
  endMidY = startMidY,
  oldZoom,
  newZoom,
  contentOffsetX = 0,
  contentOffsetY = 0,
}) {
  const f = (Number(newZoom) || 1) / (Number(oldZoom) || 1);
  return {
    scrollLeft: Math.max(0, (scrollLeft + startMidX - contentOffsetX) * f + contentOffsetX - endMidX),
    scrollTop: Math.max(0, (scrollTop + startMidY - contentOffsetY) * f + contentOffsetY - endMidY),
  };
}
