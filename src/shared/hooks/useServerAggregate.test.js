import { act, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerAggregate } from './useServerAggregate';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

/** Lets every settled promise's callbacks run. */
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function renderAggregate(props) {
    return renderHook((p) => useServerAggregate(p), { initialProps: { enabled: true, refreshKey: 0, ...props } });
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useServerAggregate', () => {
    it('runs at once when enabled and keeps the answer', async () => {
        const run = vi.fn(async () => 42);
        const { result } = renderAggregate({ run });
        expect(result.current.isLoading).toBe(true);
        await flush();
        expect(run).toHaveBeenCalledTimes(1);
        expect(result.current).toMatchObject({ value: 42, isLoading: false, error: null });
    });

    it('is loading in the very first render after it is enabled', async () => {
        const run = vi.fn(async () => 1);
        const seen = [];
        const { rerender } = renderHook((p) => {
            const state = useServerAggregate(p);
            useLayoutEffect(() => { seen.push(state.isLoading); });
            return state;
        }, { initialProps: { run, enabled: false, refreshKey: 0 } });
        expect(seen.at(-1)).toBe(false);
        seen.length = 0;
        rerender({ run, enabled: true, refreshKey: 0 });
        expect(seen[0]).toBe(true);
        await flush();
    });

    it('folds several changes inside the interval into one run', async () => {
        const run = vi.fn(async () => 1);
        const { rerender } = renderAggregate({ run });
        await flush();
        run.mockClear();

        for (const refreshKey of [1, 2, 3]) {
            rerender({ run, enabled: true, refreshKey });
            await act(async () => { vi.advanceTimersByTime(500); });
        }
        expect(run).not.toHaveBeenCalled();
        await act(async () => { vi.advanceTimersByTime(500); });
        await flush();
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('still runs every interval while changes keep coming', async () => {
        const run = vi.fn(async () => 1);
        const { rerender } = renderAggregate({ run });
        await flush();
        run.mockClear();

        for (let step = 1; step <= 12; step += 1) {
            rerender({ run, enabled: true, refreshKey: step });
            await act(async () => { vi.advanceTimersByTime(500); });
        }
        await flush();
        // Changes from 0 s to 5.5 s, every 500 ms: runs at 2 s, 4 s and 6 s.
        expect(run).toHaveBeenCalledTimes(3);
    });

    it('runs at once on refresh', async () => {
        const run = vi.fn(async () => 1);
        const { result } = renderAggregate({ run });
        await flush();
        act(() => { result.current.refresh(); });
        await flush();
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('drops an older answer that arrives after a newer one', async () => {
        const first = deferred();
        const second = deferred();
        const run = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const { result } = renderAggregate({ run });
        await flush();
        act(() => { result.current.refresh(); });
        await flush();

        await act(async () => { second.resolve(2); });
        await act(async () => { first.resolve(1); });
        expect(result.current.value).toBe(2);
    });

    it('reports a failure as no value and an error', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const err = new Error('failed-precondition');
        const run = vi.fn(async () => { throw err; });
        const { result } = renderAggregate({ run });
        await flush();
        expect(result.current).toMatchObject({ value: null, isLoading: false, error: err });
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it('reads nothing while disabled, and clears its value when turned off', async () => {
        const run = vi.fn(async () => 5);
        const { result, rerender } = renderAggregate({ run, enabled: false });
        await flush();
        expect(run).not.toHaveBeenCalled();
        expect(result.current).toMatchObject({ value: null, isLoading: false });

        rerender({ run, enabled: true, refreshKey: 0 });
        await flush();
        expect(result.current.value).toBe(5);

        rerender({ run, enabled: true, refreshKey: 1 });
        rerender({ run, enabled: false, refreshKey: 1 });
        expect(result.current.value).toBe(null);
        await act(async () => { vi.advanceTimersByTime(5000); });
        await flush();
        // The pending batch was cleared with it.
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('clears a pending timer on unmount', async () => {
        const run = vi.fn(async () => 1);
        const { rerender, unmount } = renderAggregate({ run });
        await flush();
        rerender({ run, enabled: true, refreshKey: 1 });
        unmount();
        await act(async () => { vi.advanceTimersByTime(5000); });
        expect(run).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
