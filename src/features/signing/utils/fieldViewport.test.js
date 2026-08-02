import { describe, expect, it } from 'vitest';
import { computeScrollAdjustment } from './fieldViewport';

describe('computeScrollAdjustment', () => {
    const viewport = { viewportTop: 0, viewportHeight: 600, headerOffset: 60 };

    it('returns 0 when the field is already in the comfort band', () => {
        expect(computeScrollAdjustment({ fieldTop: 100, fieldBottom: 140, ...viewport })).toBe(0);
    });

    it('scrolls down when the field would sit under the keyboard', () => {
        // Comfort bottom = 55% of 600 = 330; a field ending at 500 must move up 170px.
        const delta = computeScrollAdjustment({ fieldTop: 460, fieldBottom: 500, ...viewport });
        expect(delta).toBe(170);
    });

    it('scrolls up (negative) when the field is hidden behind the sticky header', () => {
        const delta = computeScrollAdjustment({ fieldTop: 20, fieldBottom: 50, ...viewport });
        expect(delta).toBe(-40);
    });

    it('respects visualViewport offsetTop (iOS keyboard pushes viewport down)', () => {
        // Keyboard open: visual viewport is 300px tall starting at offsetTop 0.
        const delta = computeScrollAdjustment({
            fieldTop: 280,
            fieldBottom: 310,
            viewportTop: 0,
            viewportHeight: 300,
            headerOffset: 0,
        });
        // Comfort bottom = 165 → field bottom 310 must scroll down by 145.
        expect(delta).toBe(145);
    });

    it('is a no-op for degenerate viewport heights', () => {
        expect(computeScrollAdjustment({ fieldTop: 0, fieldBottom: 10, viewportHeight: 0 })).toBe(0);
        expect(computeScrollAdjustment({ fieldTop: 0, fieldBottom: 10, viewportHeight: NaN })).toBe(0);
    });
});
