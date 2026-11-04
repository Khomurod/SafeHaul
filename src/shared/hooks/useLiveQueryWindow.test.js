import { act, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Query builders return inspectable objects, so each subscription's limit can
// be asserted; `onSnapshot` hands its callbacks to the test. All data is artificial.
const fs = vi.hoisted(() => ({
    query: vi.fn((ref, ...constraints) => ({ ref, constraints })),
    limit: vi.fn((n) => ({ __limit: n })),
    onSnapshot: vi.fn(),
}));

vi.mock('firebase/firestore', () => fs);

import { useLiveQueryWindow } from './useLiveQueryWindow';

const BASE_QUERY = { __base: 'companies/co-1/things' };

/** `n` document snapshots numbered from `from`. */
const docs = (from, n) => Array.from({ length: n }, (_, i) => ({ id: `d-${from + i}`, data: () => ({ n: from + i }) }));

let subscriptions;
let unsubscribes;

beforeEach(() => {
    vi.resetAllMocks();
    fs.query.mockImplementation((ref, ...constraints) => ({ ref, constraints }));
    fs.limit.mockImplementation((n) => ({ __limit: n }));
    subscriptions = [];
    unsubscribes = [];
    fs.onSnapshot.mockImplementation((q, next, fail) => {
        const unsubscribe = vi.fn();
        subscriptions.push({ q, next, fail });
        unsubscribes.push(unsubscribe);
        return unsubscribe;
    });
});

const latest = () => subscriptions[subscriptions.length - 1];
const limitOf = (subscription) => subscription.q.constraints.find((c) => '__limit' in c).__limit;
const emit = (snapshotDocs, metadata) => act(() => { latest().next({ docs: snapshotDocs, metadata }); });
const fail = (err = new Error('unavailable')) => act(() => { latest().fail(err); });

function renderWindow(props = {}) {
    return renderHook((p) => useLiveQueryWindow(p), {
        initialProps: {
            buildQuery: () => BASE_QUERY,
            resetKey: 'co-1',
            pageSize: 3,
            errorMessage: 'Could not load.',
            logLabel: 'Error loading things:',
            ...props,
        },
    });
}

describe('useLiveQueryWindow', () => {
    it('subscribes to the query with limit(pageSize) and maps each document', () => {
        const { result } = renderWindow();
        expect(fs.onSnapshot).toHaveBeenCalledTimes(1);
        expect(latest().q.ref).toBe(BASE_QUERY);
        expect(limitOf(latest())).toBe(3);
        expect(result.current.isLoading).toBe(true);

        emit(docs(0, 2));
        expect(result.current.docs).toEqual([{ id: 'd-0', n: 0 }, { id: 'd-1', n: 1 }]);
        expect(result.current.isLoading).toBe(false);
        expect(result.current.hasMore).toBe(false);
    });

    it('says there may be more when a snapshot fills the window', () => {
        const { result } = renderWindow();
        emit(docs(0, 3));
        expect(result.current.hasMore).toBe(true);
    });

    it('grows the window by pageSize on loadMore, keeping the rows until the bigger window answers', () => {
        const { result } = renderWindow();
        emit(docs(0, 3));
        act(() => { result.current.loadMore(); });

        expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
        expect(subscriptions).toHaveLength(2);
        expect(limitOf(latest())).toBe(6);
        expect(result.current.isLoadingMore).toBe(true);
        expect(result.current.docs).toHaveLength(3);

        emit(docs(0, 5));
        expect(result.current.docs).toHaveLength(5);
        expect(result.current.isLoadingMore).toBe(false);
        expect(result.current.hasMore).toBe(false);
    });

    it('keeps hasMore when a later snapshot shrinks a full window', () => {
        // A delete in a full window is answered from the local cache with one
        // row fewer before the server refills it; its key leaves the pending
        // writes with the row, so the snapshot says nothing about a write.
        const { result } = renderWindow();
        emit(docs(0, 3));
        emit(docs(1, 2), { fromCache: false, hasPendingWrites: false });
        expect(result.current.docs).toHaveLength(2);
        expect(result.current.hasMore).toBe(true);

        emit(docs(1, 3));
        expect(result.current.hasMore).toBe(true);
    });

    it('starts hasMore afresh with each subscription', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderWindow();
        emit(docs(0, 3));
        fail();
        act(() => { result.current.retry(); });
        emit(docs(0, 2));
        expect(result.current.hasMore).toBe(false);
        consoleError.mockRestore();
    });

    it('does nothing on loadMore while nothing more can exist or a load is pending', () => {
        const { result } = renderWindow();
        act(() => { result.current.loadMore(); });
        expect(subscriptions).toHaveLength(1);

        emit(docs(0, 2));
        act(() => { result.current.loadMore(); });
        expect(subscriptions).toHaveLength(1);
    });

    it('ignores a smaller answer from the cache while a load-more is pending', () => {
        const { result } = renderWindow();
        emit(docs(0, 3));
        act(() => { result.current.loadMore(); });

        emit(docs(0, 1), { fromCache: true });
        expect(result.current.docs).toHaveLength(3);
        expect(result.current.isLoadingMore).toBe(true);
        expect(result.current.hasMore).toBe(true);

        emit(docs(0, 6), { fromCache: false });
        expect(result.current.docs).toHaveLength(6);
        expect(result.current.isLoadingMore).toBe(false);
    });

    it('starts again at pageSize, with no rows, for another resetKey', () => {
        const { result, rerender } = renderWindow();
        emit(docs(0, 3));
        act(() => { result.current.loadMore(); });
        emit(docs(0, 6));

        rerender({ buildQuery: () => BASE_QUERY, resetKey: 'co-2', pageSize: 3, errorMessage: 'x', logLabel: 'y' });
        expect(result.current.docs).toEqual([]);
        expect(result.current.isLoading).toBe(true);
        expect(limitOf(latest())).toBe(3);
    });

    it('is loading in the very first render after it is enabled', () => {
        const seen = [];
        const { rerender } = renderHook((p) => {
            const state = useLiveQueryWindow(p);
            // Every committed render, before effects can adjust it.
            useLayoutEffect(() => { seen.push({ isLoading: state.isLoading, docs: state.docs.length }); });
            return state;
        }, { initialProps: { buildQuery: () => BASE_QUERY, resetKey: 'co-1', pageSize: 3, enabled: false } });

        expect(seen.at(-1)).toEqual({ isLoading: false, docs: 0 });
        expect(fs.onSnapshot).not.toHaveBeenCalled();
        seen.length = 0;
        rerender({ buildQuery: () => BASE_QUERY, resetKey: 'co-1', pageSize: 3, enabled: true });
        expect(seen[0]).toEqual({ isLoading: true, docs: 0 });
    });

    it('reports a failure with the given message and logs it', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderWindow();
        const err = new Error('permission-denied');
        fail(err);
        expect(result.current.error).toBe('Could not load.');
        expect(result.current.isLoading).toBe(false);
        expect(consoleError).toHaveBeenCalledWith('Error loading things:', err);
        consoleError.mockRestore();
    });

    it('keeps the rows and goes back to the last window when a load-more fails', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderWindow();
        emit(docs(0, 3));
        act(() => { result.current.loadMore(); });
        fail();

        expect(result.current.loadMoreFailed).toBe(true);
        expect(result.current.error).toBe(null);
        expect(result.current.isLoadingMore).toBe(false);
        expect(result.current.docs).toHaveLength(3);
        expect(limitOf(latest())).toBe(3);

        // Pressing again clears the failure.
        emit(docs(0, 3));
        act(() => { result.current.loadMore(); });
        expect(result.current.loadMoreFailed).toBe(false);
        expect(limitOf(latest())).toBe(6);
        consoleError.mockRestore();
    });

    it('subscribes again on retry', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderWindow();
        fail();
        act(() => { result.current.retry(); });
        expect(result.current.error).toBe(null);
        expect(result.current.isLoading).toBe(true);
        expect(subscriptions).toHaveLength(2);

        emit(docs(0, 1));
        expect(result.current.isLoading).toBe(false);
        consoleError.mockRestore();
    });

    it('reads nothing while disabled', () => {
        const build = vi.fn(() => BASE_QUERY);
        const { result } = renderWindow({ enabled: false, buildQuery: build });
        expect(fs.onSnapshot).not.toHaveBeenCalled();
        expect(build).not.toHaveBeenCalled();
        expect(result.current).toMatchObject({ docs: [], isLoading: false, hasMore: false });
    });

    it('subscribes nothing again for a new buildQuery function', () => {
        const { rerender } = renderWindow();
        rerender({ buildQuery: () => BASE_QUERY, resetKey: 'co-1', pageSize: 3 });
        expect(fs.onSnapshot).toHaveBeenCalledTimes(1);
    });

    it('counts the snapshots after the first of each subscription', () => {
        const { result } = renderWindow();
        emit(docs(0, 3));
        expect(result.current.snapshotVersion).toBe(0);
        emit(docs(0, 3));
        expect(result.current.snapshotVersion).toBe(1);

        act(() => { result.current.loadMore(); });
        emit(docs(0, 6));
        // The first answer of the grown window is not a change.
        expect(result.current.snapshotVersion).toBe(1);
        emit(docs(0, 6));
        expect(result.current.snapshotVersion).toBe(2);
    });

    it('unsubscribes on unmount', () => {
        const { unmount } = renderWindow();
        unmount();
        expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
    });
});
