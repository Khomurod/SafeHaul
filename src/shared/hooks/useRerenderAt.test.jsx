import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRerenderAt } from './useRerenderAt';

describe('useRerenderAt', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('re-renders once just after the moment, and not before', () => {
        const at = Date.now() + 60_000;
        const { result } = renderHook(() => useRerenderAt(at));
        expect(result.current).toBe(0);

        act(() => { vi.advanceTimersByTime(60_000); });
        expect(result.current).toBe(0);

        act(() => { vi.advanceTimersByTime(1_000); });
        expect(result.current).toBe(1);

        act(() => { vi.advanceTimersByTime(10 * 60_000); });
        expect(result.current).toBe(1);
    });

    it.each([
        ['a moment already past', () => Date.now() - 1],
        ['no moment', () => null],
        ['not a number', () => 'soon'],
    ])('schedules nothing for %s', (_label, at) => {
        const { result } = renderHook(() => useRerenderAt(at()));
        act(() => { vi.advanceTimersByTime(24 * 60 * 60_000); });
        expect(result.current).toBe(0);
    });

    it('clears its timer when the caller goes', () => {
        const { unmount } = renderHook(() => useRerenderAt(Date.now() + 60_000));
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
