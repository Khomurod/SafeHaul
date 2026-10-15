import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

const realMatchMedia = window.matchMedia;

/** A media query list whose answer the test changes, with the listener API the browser offers. */
function stubMatchMedia(initial, { legacy = false } = {}) {
    const listeners = new Set();
    const mql = { matches: initial };
    if (legacy) {
        mql.addListener = vi.fn((fn) => listeners.add(fn));
        mql.removeListener = vi.fn((fn) => listeners.delete(fn));
    } else {
        mql.addEventListener = vi.fn((type, fn) => listeners.add(fn));
        mql.removeEventListener = vi.fn((type, fn) => listeners.delete(fn));
    }
    window.matchMedia = vi.fn(() => mql);
    return {
        mql,
        listeners,
        change(matches) {
            mql.matches = matches;
            act(() => listeners.forEach((fn) => fn({ matches })));
        },
    };
}

afterEach(() => {
    window.matchMedia = realMatchMedia;
});

describe('useMediaQuery', () => {
    it('answers the query at once and follows its changes', () => {
        const media = stubMatchMedia(true);
        const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
        expect(result.current).toBe(true);
        expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767px)');

        media.change(false);
        expect(result.current).toBe(false);
    });

    it('uses the older addListener API where that is all the browser has', () => {
        const media = stubMatchMedia(false, { legacy: true });
        const { result, unmount } = renderHook(() => useMediaQuery('(max-width: 639px)'));
        media.change(true);
        expect(result.current).toBe(true);

        unmount();
        expect(media.mql.removeListener).toHaveBeenCalledTimes(1);
        expect(media.listeners.size).toBe(0);
    });

    it('stops listening when unmounted', () => {
        const media = stubMatchMedia(false);
        const { unmount } = renderHook(() => useMediaQuery('(max-width: 1023px)'));
        unmount();
        expect(media.listeners.size).toBe(0);
    });

    it('reports the desktop layout where matchMedia is missing', () => {
        window.matchMedia = undefined;
        const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
        expect(result.current).toBe(false);
    });
});
