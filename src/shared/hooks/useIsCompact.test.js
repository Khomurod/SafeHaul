import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPACT_QUERY, useIsCompact } from './useIsCompact';

const realMatchMedia = window.matchMedia;

/** Answers the query as a window of `width` pixels would. */
function windowOf(width) {
    window.matchMedia = vi.fn((query) => {
        const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1]);
        return { matches: width <= max, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    });
}

afterEach(() => {
    window.matchMedia = realMatchMedia;
});

describe('useIsCompact', () => {
    it('asks for windows up to 1180px: phones and tablets', () => {
        expect(COMPACT_QUERY).toBe('(max-width: 1180px)');
    });

    it.each([
        [360, true],
        [768, true],
        [1024, true],
        [1180, true],
        [1181, false],
        [1366, false],
    ])('a %ipx window is compact: %s', (width, compact) => {
        windowOf(width);
        const { result } = renderHook(() => useIsCompact());
        expect(result.current).toBe(compact);
        expect(window.matchMedia).toHaveBeenCalledWith(COMPACT_QUERY);
    });
});
