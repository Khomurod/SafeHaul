import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The window of the newest documents is a controllable stand-in; the attention
// listener and the counts run on recording Firestore mocks. All data is artificial.
const fs = vi.hoisted(() => ({
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    or: vi.fn(),
    and: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    onSnapshot: vi.fn(),
    getCountFromServer: vi.fn(),
}));
const windowed = vi.hoisted(() => ({ current: null }));
const e2eParams = vi.hoisted(() => ({ current: {} }));

vi.mock('firebase/firestore', () => fs);
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({
    isE2ETestMode: true,
    getE2EQueryParam: (name, fallback = '') => e2eParams.current[name] ?? fallback,
}));
vi.mock('@features/signing/hooks/useSigningRequests', () => ({
    SIGNING_REQUESTS_PAGE_SIZE: 100,
    useSigningRequests: (companyId) => {
        windowed.companyId = companyId;
        return windowed.current;
    },
}));

import { useDocumentsWorkspaceData } from './useDocumentsWorkspaceData';
import { summarizeDocuments } from '../utils/documentsWorkspace';

/** `n` signing requests; every `failEvery`th one has a failed email. */
const requests = (n, { failEvery = 0 } = {}) => Array.from({ length: n }, (_, i) => ({
    id: `req-${i}`,
    title: `Artificial Form ${i}`,
    status: i % 3 === 0 ? 'signed' : 'sent',
    ...(failEvery && i % failEvery === 0 ? { emailStatus: 'failed' } : {}),
}));

const windowState = (documents, overrides = {}) => ({
    documents,
    isLoading: false,
    loadError: null,
    retry: vi.fn(),
    hasMore: false,
    loadMore: vi.fn(),
    isLoadingMore: false,
    loadMoreFailed: false,
    snapshotVersion: 0,
    ...overrides,
});

const COUNTS = { total: 412, awaiting: 60, awaitingFailed: 7, completed: 300, needsAttention: 19 };
function countName(countQuery) {
    const [filter] = countQuery.constraints;
    if (!filter) return 'total';
    if (filter.kind === 'and') return 'awaitingFailed';
    if (filter.kind === 'or') return 'needsAttention';
    return filter.value.includes('sent') ? 'awaiting' : 'completed';
}

let listeners;

beforeEach(() => {
    vi.resetAllMocks();
    fs.collection.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    fs.query.mockImplementation((ref, ...constraints) => ({ ref, constraints }));
    fs.where.mockImplementation((field, op, value) => ({ kind: 'where', field, op, value }));
    fs.or.mockImplementation((...filters) => ({ kind: 'or', filters }));
    fs.and.mockImplementation((...filters) => ({ kind: 'and', filters }));
    fs.orderBy.mockImplementation((field, direction) => ({ kind: 'orderBy', field, direction }));
    fs.limit.mockImplementation((n) => ({ kind: 'limit', n }));
    fs.getCountFromServer.mockImplementation(async (q) => ({ data: () => ({ count: COUNTS[countName(q)] }) }));
    listeners = [];
    fs.onSnapshot.mockImplementation((q, next, fail) => {
        listeners.push({ q, next, fail });
        return vi.fn();
    });
    windowed.current = windowState([]);
    e2eParams.current = {};
});

const renderData = (props = {}) => renderHook((p) => useDocumentsWorkspaceData(p), {
    initialProps: { companyId: 'co-1', isE2EEdocMock: false, ...props },
});
const attentionSnapshot = (docs) => act(() => {
    listeners.at(-1).next({ docs: docs.map((d) => ({ id: d.id, data: () => ({ ...d, id: undefined }) })) });
});

describe('useDocumentsWorkspaceData — every document loaded', () => {
    it('reads nothing else and computes the numbers from the loaded rows', async () => {
        const documents = requests(12, { failEvery: 4 });
        windowed.current = windowState(documents);
        const { result } = renderData();
        await act(async () => {});

        expect(fs.onSnapshot).not.toHaveBeenCalled();
        expect(fs.getCountFromServer).not.toHaveBeenCalled();
        expect(result.current.summary).toEqual(summarizeDocuments(documents));
        expect(result.current.list).toMatchObject({ complete: true, hasMore: false, total: 12 });
        expect(result.current.attention).toMatchObject({ complete: true, isLoading: false, error: null, total: 3 });
        expect(result.current.attention.documents.map((d) => d.id)).toEqual(['req-0', 'req-4', 'req-8']);
        expect(result.current.countsError).toBe(null);
    });

    it('hands on the window’s own array', () => {
        const documents = requests(3);
        windowed.current = windowState(documents);
        const { result, rerender } = renderData();
        rerender({ companyId: 'co-1', isE2EEdocMock: false });
        expect(result.current.documents).toBe(documents);
    });

    it('treats a window that says nothing about more as complete', () => {
        windowed.current = { documents: requests(2), isLoading: false, loadError: null, retry: vi.fn() };
        const { result } = renderData();
        expect(result.current.list.complete).toBe(true);
        expect(fs.onSnapshot).not.toHaveBeenCalled();
    });
});

describe('useDocumentsWorkspaceData — a full window', () => {
    it('listens to the documents that need attention, newest 100, and counts on the server', async () => {
        const documents = requests(100);
        windowed.current = windowState(documents, { hasMore: true });
        const { result } = renderData();

        expect(fs.onSnapshot).toHaveBeenCalledTimes(1);
        const [{ q }] = listeners;
        expect(q.constraints).toEqual([{ kind: 'limit', n: 100 }]);
        expect(q.ref.ref).toEqual({ path: 'companies/co-1/signing_requests' });
        expect(q.ref.constraints[0].kind).toBe('or');
        expect(q.ref.constraints[1]).toEqual({ kind: 'orderBy', field: 'createdAt', direction: 'desc' });
        expect(result.current.attention.isLoading).toBe(true);
        // Unknown until the counts answer: a dash, never a zero.
        expect(result.current.summary).toBe(null);

        await waitFor(() => expect(result.current.summary).toEqual({
            total: 412, awaitingSignature: 53, completed: 300, needsAttention: 19,
        }));
        expect(result.current.list).toMatchObject({ complete: false, hasMore: true, total: 412 });
        expect(result.current.list.loadMore).toBe(windowed.current.loadMore);
        expect(result.current.documents).toBe(documents);

        attentionSnapshot(requests(19, { failEvery: 1 }));
        expect(result.current.attention).toMatchObject({ isLoading: false, error: null, total: 19, complete: true });
        expect(result.current.attention.documents).toHaveLength(19);
    });

    it('passes on the attention listener’s failure and its retry', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        windowed.current = windowState(requests(100), { hasMore: true });
        const { result } = renderData();
        await waitFor(() => expect(result.current.summary).not.toBe(null));

        act(() => { listeners[0].fail(new Error('failed-precondition')); });
        expect(result.current.attention.error).toBe('Documents that need attention could not be loaded.');
        act(() => { result.current.attention.retry(); });
        expect(fs.onSnapshot).toHaveBeenCalledTimes(2);
        consoleError.mockRestore();
    });

    it('passes on a failure of the counts', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        fs.getCountFromServer.mockImplementation(async () => { throw new Error('unavailable'); });
        windowed.current = windowState(requests(100), { hasMore: true });
        const { result } = renderData();
        await waitFor(() => expect(result.current.countsError).toBeTruthy());
        expect(result.current.summary).toBe(null);
        expect(result.current.list).toMatchObject({ complete: false, total: null });
        expect(typeof result.current.retryCounts).toBe('function');
        consoleError.mockRestore();
    });

    it('offers no Load older when exactly 100 of 100 are loaded', async () => {
        fs.getCountFromServer.mockImplementation(async (q) => ({ data: () => ({ count: countName(q) === 'total' ? 100 : 0 }) }));
        windowed.current = windowState(requests(100), { hasMore: true });
        const { result } = renderData();
        await waitFor(() => expect(result.current.summary?.total).toBe(100));
        expect(result.current.list.complete).toBe(true);
    });
});

describe('useDocumentsWorkspaceData — E2E fixtures', () => {
    it('serves the six fixture rows, all loaded, for e2eEdocSent=mock', () => {
        e2eParams.current = { e2eEdocSent: 'mock' };
        const { result } = renderData({ isE2EEdocMock: true });
        expect(windowed.companyId).toBe(null);
        expect(result.current.documents).toHaveLength(6);
        expect(result.current.list.complete).toBe(true);
        expect(result.current.summary).toMatchObject({ awaitingSignature: 1, completed: 2, needsAttention: 2 });
    });

    it('serves 230 rows 100 at a time for e2eEdocSent=many, with numbers over all 230', () => {
        e2eParams.current = { e2eEdocSent: 'many' };
        const { result } = renderData({ isE2EEdocMock: true });

        expect(result.current.documents).toHaveLength(100);
        expect(result.current.list).toMatchObject({ complete: false, hasMore: true, total: 230 });
        expect(result.current.summary).toMatchObject({ total: 230, awaitingSignature: 39, completed: 77, needsAttention: 76 });
        expect(result.current.attention).toMatchObject({ complete: true, total: 76 });

        act(() => { result.current.list.loadMore(); });
        expect(result.current.documents).toHaveLength(200);
        act(() => { result.current.list.loadMore(); });
        expect(result.current.documents).toHaveLength(230);
        expect(result.current.list).toMatchObject({ complete: true, hasMore: false });
        expect(fs.onSnapshot).not.toHaveBeenCalled();
        expect(fs.getCountFromServer).not.toHaveBeenCalled();
    });
});
