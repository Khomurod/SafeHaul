import { describe, expect, it } from 'vitest';
import {
  PDF_VIEWPORT_WIDTH_DEFAULT,
  PDF_VIEWPORT_WIDTH_MIN,
  PDF_VIEWPORT_WIDTH_MAX,
  adjustPdfViewportWidth,
  clampPdfViewportWidth,
  zoomPercentLabel,
  DELTA_PIXEL,
  DELTA_LINE,
  SIGNER_ZOOM_MIN,
  SIGNER_ZOOM_MAX,
  clampSignerZoom,
  computePinchZoom,
  computeZoomScrollOffsets,
  touchDistance,
  touchMidpoint,
} from './envelopePdfZoom';

describe('envelopePdfZoom', () => {
  it('clampPdfViewportWidth enforces bounds', () => {
    expect(clampPdfViewportWidth(50)).toBe(PDF_VIEWPORT_WIDTH_MIN);
    expect(clampPdfViewportWidth(5000)).toBe(PDF_VIEWPORT_WIDTH_MAX);
    expect(clampPdfViewportWidth(701.4)).toBe(701);
  });

  it('adjustPdfViewportWidth shrinks on positive deltaY (scroll down)', () => {
    const next = adjustPdfViewportWidth(700, 100, DELTA_PIXEL);
    expect(next).toBeLessThan(700);
    expect(next).toBeGreaterThanOrEqual(PDF_VIEWPORT_WIDTH_MIN);
  });

  it('adjustPdfViewportWidth grows on negative deltaY (scroll up)', () => {
    const next = adjustPdfViewportWidth(700, -100, DELTA_PIXEL);
    expect(next).toBeGreaterThan(700);
    expect(next).toBeLessThanOrEqual(PDF_VIEWPORT_WIDTH_MAX);
  });

  it('respects line delta mode with larger steps', () => {
    const px = adjustPdfViewportWidth(700, 3, DELTA_PIXEL);
    const ln = adjustPdfViewportWidth(700, 3, DELTA_LINE);
    expect(Math.abs(700 - ln)).toBeGreaterThan(Math.abs(700 - px));
  });

  it('zoomPercentLabel rounds against default width', () => {
    expect(zoomPercentLabel(PDF_VIEWPORT_WIDTH_DEFAULT)).toBe(100);
    expect(zoomPercentLabel(350)).toBe(50);
  });
});

describe('signer zoom (document-first signing room)', () => {
  it('clampSignerZoom enforces bounds and rejects non-finite input', () => {
    expect(clampSignerZoom(0.2)).toBe(SIGNER_ZOOM_MIN);
    expect(clampSignerZoom(99)).toBe(SIGNER_ZOOM_MAX);
    expect(clampSignerZoom(2.5)).toBe(2.5);
    expect(clampSignerZoom(NaN)).toBe(SIGNER_ZOOM_MIN);
    expect(clampSignerZoom('nope')).toBe(SIGNER_ZOOM_MIN);
  });

  it('computePinchZoom scales by finger-spread ratio from the start zoom', () => {
    expect(computePinchZoom({ startZoom: 1, startDistance: 100, currentDistance: 200 })).toBe(2);
    expect(computePinchZoom({ startZoom: 2, startDistance: 100, currentDistance: 50 })).toBe(1);
  });

  it('computePinchZoom clamps at the extremes and guards zero distance', () => {
    expect(computePinchZoom({ startZoom: 3, startDistance: 50, currentDistance: 500 })).toBe(SIGNER_ZOOM_MAX);
    expect(computePinchZoom({ startZoom: 1, startDistance: 100, currentDistance: 1 })).toBe(SIGNER_ZOOM_MIN);
    expect(computePinchZoom({ startZoom: 2, startDistance: 0, currentDistance: 100 })).toBe(2);
  });

  it('computeZoomScrollOffsets keeps the document point under the midpoint stationary', () => {
    // Content point under the fingers: scrollLeft(50) + midX(50) = 100 content px.
    // At 2x it lands at 200; to keep it under midX the scroller must sit at 150.
    const next = computeZoomScrollOffsets({
      scrollLeft: 50,
      scrollTop: 120,
      startMidX: 50,
      startMidY: 80,
      oldZoom: 1,
      newZoom: 2,
    });
    expect(next.scrollLeft).toBe(150);
    // (scrollTop 120 + midY 80) * 2 - midY 80 = 320
    expect(next.scrollTop).toBe(320);
  });

  it('computeZoomScrollOffsets accounts for midpoint drift (pan while pinching)', () => {
    const next = computeZoomScrollOffsets({
      scrollLeft: 0,
      scrollTop: 0,
      startMidX: 100,
      startMidY: 100,
      endMidX: 140, // fingers drifted right/down 40px while pinching
      endMidY: 140,
      oldZoom: 1,
      newZoom: 2,
    });
    expect(next.scrollLeft).toBe(60);
    expect(next.scrollTop).toBe(60);
  });

  it('computeZoomScrollOffsets leaves the unscaled gutter out of the scaling', () => {
    // Page stack starts 20px into the scrollable area (gutter padding). The
    // document point is (0 + 100 - 20) = 80 stack px → 160 at 2x → +20 gutter
    // − 100 midpoint = 80.
    const next = computeZoomScrollOffsets({
      scrollLeft: 0,
      scrollTop: 0,
      startMidX: 100,
      startMidY: 100,
      oldZoom: 1,
      newZoom: 2,
      contentOffsetX: 20,
      contentOffsetY: 20,
    });
    expect(next.scrollLeft).toBe(80);
    expect(next.scrollTop).toBe(80);
  });

  it('computeZoomScrollOffsets never returns negative scroll positions', () => {
    const next = computeZoomScrollOffsets({
      scrollLeft: 0,
      scrollTop: 0,
      startMidX: 10,
      startMidY: 10,
      oldZoom: 2,
      newZoom: 1, // zooming out near the origin would go negative without the clamp
    });
    expect(next.scrollLeft).toBe(0);
    expect(next.scrollTop).toBe(0);
  });

  it('touchDistance / touchMidpoint compute gesture geometry', () => {
    const a = { clientX: 0, clientY: 0 };
    const b = { clientX: 30, clientY: 40 };
    expect(touchDistance(a, b)).toBe(50);
    expect(touchMidpoint(a, b)).toEqual({ x: 15, y: 20 });
  });
});
