import { act, renderHook, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Query builders return inspectable objects, so each read's path, order,
// cursor, filter and limit can be asserted. All data is artificial.
const fs = vi.hoisted(() => ({
    collection: vi.fn((_db, ...segments) => ({ __collection: segments.join('/') })),
    query: vi.fn((ref, ...constraints) => ({ ref, constraints })),
    orderBy: vi.fn((field, direction) => ({ __orderBy: [field, direction] })),
    limit: vi.fn((n) => ({ __limit: n })),
    startAfter: vi.fn((cursor) => ({ __startAfter: cursor })),
    where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
    getDocs: vi.fn(async () => ({ docs: [] })),
    getCountFromServer: vi.fn(async () => ({ data: () => ({ count: 0 }) })),
}));

vi.mock('firebase/firestore', () => fs);
vi.mock('@lib/firebase', () => ({ db: {} }));

import { LOG_PAGE_SIZE, useCampaignLogs } from './useCampaignLogs';

const PATH = 'companies/co-1/bulk_sessions/s-1/logs';

/** `n` log documents numbered from `from`. */
const logDocs = (from, n, status = 'delivered') => Array.from({ length: n }, (_, i) => ({
    id: `log-${from + i}`,
    data: () => ({ recipientName: `Recipient ${from + i + 1}`, status }),
}));
const snapshot = (docs) => ({ docs });
const countOf = (count) => ({ data: () => ({ count }) });
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

/** The `limit` of each `getDocs` call so far. */
const readLimits = () => fs.getDocs.mock.calls.map(([q]) => q.constraints.find((c) => '__limit' in c).__limit);

function renderLogs(props = {}) {
    return renderHook((p) => useCampaignLogs(p), {
        initialProps: { companyId: 'co-1', sessionId: 's-1', ...props },
    });
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe('useCampaignLogs — the first read', () => {
    it('reads the newest 200 logs, ordered by timestamp desc', async () => {
        fs.getDocs.mockResolvedValueOnce(snapshot(logDocs(0, 3)));
        const { result } = renderLogs();

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(LOG_PAGE_SIZE).toBe(200);
        expect(fs.collection).toHaveBeenCalledWith({}, 'companies', 'co-1', 'bulk_sessions', 's-1', 'logs');
        expect(fs.getDocs).toHaveBeenCalledTimes(1);
        expect(fs.getDocs).toHaveBeenCalledWith({
            ref: { __collection: PATH },
            constraints: [{ __orderBy: ['timestamp', 'desc'] }, { __limit: 200 }],
        });
        expect(result.current.logs.map((log) => log.id)).toEqual(['log-0', 'log-1', 'log-2']);
        expect(result.current.logs[0]).toEqual({ id: 'log-0', recipientName: 'Recipient 1', status: 'delivered' });
    });

    it('takes the total from a count of the same ordered query', async () => {
        fs.getCountFromServer.mockResolvedValue(countOf(450));
        const { result } = renderLogs();

        await waitFor(() => expect(result.current.total).toBe(450));
        expect(fs.getCountFromServer).toHaveBeenCalledTimes(1);
        expect(fs.getCountFromServer).toHaveBeenCalledWith({
            ref: { __collection: PATH },
            constraints: [{ __orderBy: ['timestamp', 'desc'] }],
        });
        expect(fs.where).not.toHaveBeenCalled();
    });

    it('is loading in the very first render after the session arrives', async () => {
        const committed = [];
        const { result, rerender } = renderHook((p) => {
            const logs = useCampaignLogs(p);
            // Only what is committed (painted); a render React throws away is not recorded.
            useLayoutEffect(() => { committed.push(logs.loading); });
            return logs;
        }, { initialProps: { companyId: 'co-1', sessionId: null } });

        expect(committed).toEqual([false]);
        const read = deferred();
        fs.getDocs.mockReturnValueOnce(read.promise);
        rerender({ companyId: 'co-1', sessionId: 's-1' });

        expect(committed[1]).toBe(true);
        await act(async () => { read.resolve(snapshot(logDocs(0, 1))); });
        expect(result.current.loading).toBe(false);
    });

    it.each([
        ['the company id is missing', { companyId: undefined }],
        ['the session id is missing', { sessionId: null }],
    ])('reads nothing when %s', async (_label, props) => {
        const { result } = renderLogs(props);
        await act(async () => {});

        expect(fs.getDocs).not.toHaveBeenCalled();
        expect(fs.getCountFromServer).not.toHaveBeenCalled();
        expect(fs.collection).not.toHaveBeenCalled();
        expect(result.current).toMatchObject({ logs: [], loading: false, total: null, hasMore: false });
    });

    it('drops the first read of an older session that answers after the newer one', async () => {
        const older = deferred();
        fs.getDocs
            .mockReturnValueOnce(older.promise)
            .mockResolvedValueOnce(snapshot(logDocs(100, 2)));
        const { result, rerender } = renderLogs();
        rerender({ companyId: 'co-1', sessionId: 's-2' });

        await waitFor(() => expect(result.current.logs.map((log) => log.id)).toEqual(['log-100', 'log-101']));
        await act(async () => { older.resolve(snapshot(logDocs(0, 2))); });
        expect(result.current.logs.map((log) => log.id)).toEqual(['log-100', 'log-101']);
    });

    it('keeps the rows with a null total when the count fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        fs.getDocs.mockResolvedValueOnce(snapshot(logDocs(0, 200)));
        fs.getCountFromServer.mockRejectedValueOnce(new Error('unavailable'));
        const { result } = renderLogs();

        await waitFor(() => expect(consoleError).toHaveBeenCalledWith('Failed to count campaign logs:', expect.any(Error)));
        expect(result.current.logs).toHaveLength(200);
        expect(result.current.total).toBeNull();
        // Without a total, a full page is all that says more may exist.
        expect(result.current.hasMore).toBe(true);
        consoleError.mockRestore();
    });

    it('calls onError once for a failed read, and reads nothing again when onError changes', async () => {
        const failure = new Error('permission-denied');
        fs.getDocs.mockRejectedValueOnce(failure);
        const onError = vi.fn();
        const { result, rerender } = renderLogs({ onError });

        await waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
        expect(result.current).toMatchObject({ loading: false, failed: true, logs: [] });
        rerender({ companyId: 'co-1', sessionId: 's-1', onError: vi.fn() });
        await act(async () => {});

        expect(onError).toHaveBeenCalledTimes(1);
        expect(fs.getDocs).toHaveBeenCalledTimes(1);
    });

    it('says the read failed until a reload reads the rows', async () => {
        fs.getDocs.mockRejectedValueOnce(new Error('unavailable'));
        const { result, rerender } = renderLogs({ onError: vi.fn() });
        await waitFor(() => expect(result.current.failed).toBe(true));

        const reload = deferred();
        fs.getDocs.mockReturnValueOnce(reload.promise);
        rerender({ companyId: 'co-1', sessionId: 's-1', refreshKey: 1 });
        // Still failed while the reload is out: nothing reads as an empty log meanwhile.
        expect(result.current).toMatchObject({ failed: true, logs: [] });

        await act(async () => { reload.resolve(snapshot(logDocs(0, 2))); });
        expect(result.current.failed).toBe(false);
        expect(result.current.logs.map((log) => log.id)).toEqual(['log-0', 'log-1']);
    });
});

describe('useCampaignLogs — more pages', () => {
    it('starts the next page after the last log shown and appends it without duplicates', async () => {
        const first = logDocs(0, 200);
        fs.getDocs
            .mockResolvedValueOnce(snapshot(first))
            // A log already shown comes back on the next page: it is not listed twice.
            .mockResolvedValueOnce(snapshot([first[199], ...logDocs(200, 50)]));
        fs.getCountFromServer.mockResolvedValue(countOf(250));
        const { result } = renderLogs();
        await waitFor(() => expect(result.current.hasMore).toBe(true));

        await act(async () => { await result.current.loadMore(); });

        expect(fs.startAfter).toHaveBeenCalledWith(first[199]);
        expect(fs.getDocs).toHaveBeenLastCalledWith({
            ref: { __collection: PATH },
            constraints: [{ __orderBy: ['timestamp', 'desc'] }, { __startAfter: first[199] }, { __limit: 200 }],
        });
        const ids = result.current.logs.map((log) => log.id);
        expect(ids).toHaveLength(250);
        expect(new Set(ids).size).toBe(250);
        expect(ids[200]).toBe('log-200');
        expect(result.current.hasMore).toBe(false);
    });

    it('has no more after a short page', async () => {
        fs.getDocs.mockResolvedValueOnce(snapshot(logDocs(0, 12)));
        fs.getCountFromServer.mockResolvedValue(countOf(900));
        const { result } = renderLogs();

        await waitFor(() => expect(result.current.total).toBe(900));
        expect(result.current.hasMore).toBe(false);
    });

    it('has no more when the rows shown reach the total', async () => {
        fs.getDocs.mockResolvedValueOnce(snapshot(logDocs(0, 200)));
        fs.getCountFromServer.mockResolvedValue(countOf(200));
        const { result } = renderLogs();

        await waitFor(() => expect(result.current.total).toBe(200));
        expect(result.current.logs).toHaveLength(200);
        expect(result.current.hasMore).toBe(false);
    });

    it('keeps the rows and says so when a page fails, then clears that on the next try', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        fs.getDocs
            .mockResolvedValueOnce(snapshot(logDocs(0, 200)))
            .mockRejectedValueOnce(new Error('unavailable'));
        fs.getCountFromServer.mockResolvedValue(countOf(300));
        const { result } = renderLogs();
        await waitFor(() => expect(result.current.hasMore).toBe(true));

        await act(async () => { await result.current.loadMore(); });
        expect(result.current).toMatchObject({ loadMoreFailed: true, loadingMore: false, hasMore: true });
        expect(result.current.logs).toHaveLength(200);

        const retry = deferred();
        fs.getDocs.mockReturnValueOnce(retry.promise);
        act(() => { result.current.loadMore(); });
        expect(result.current).toMatchObject({ loadMoreFailed: false, loadingMore: true });
        await act(async () => { retry.resolve(snapshot(logDocs(200, 100))); });
        expect(result.current.logs).toHaveLength(300);
        consoleError.mockRestore();
    });

    it('reads one page at a time when pressed twice', async () => {
        fs.getDocs.mockResolvedValueOnce(snapshot(logDocs(0, 200)));
        fs.getCountFromServer.mockResolvedValue(countOf(300));
        const { result } = renderLogs();
        await waitFor(() => expect(result.current.hasMore).toBe(true));

        const page = deferred();
        fs.getDocs.mockReturnValueOnce(page.promise);
        act(() => {
            result.current.loadMore();
            result.current.loadMore();
        });
        await act(async () => { page.resolve(snapshot(logDocs(200, 100))); });

        expect(fs.getDocs).toHaveBeenCalledTimes(2);
        expect(result.current.logs).toHaveLength(300);
    });
});

describe('useCampaignLogs — reloads', () => {
    it('reads again as many rows as are shown, keeping them on screen meanwhile', async () => {
        fs.getDocs
            .mockResolvedValueOnce(snapshot(logDocs(0, 200)))
            .mockResolvedValueOnce(snapshot(logDocs(200, 200)));
        fs.getCountFromServer.mockResolvedValue(countOf(450));
        const { result, rerender } = renderLogs({ refreshKey: 0 });
        await waitFor(() => expect(result.current.hasMore).toBe(true));
        await act(async () => { await result.current.loadMore(); });
        expect(result.current.logs).toHaveLength(400);

        const reload = deferred();
        fs.getDocs.mockReturnValueOnce(reload.promise);
        rerender({ companyId: 'co-1', sessionId: 's-1', refreshKey: 1 });

        expect(readLimits()).toEqual([200, 200, 400]);
        expect(result.current.loading).toBe(false);
        expect(result.current.logs).toHaveLength(400);

        await act(async () => { reload.resolve(snapshot(logDocs(0, 400, 'failed'))); });
        expect(result.current.logs).toHaveLength(400);
        expect(result.current.logs.every((log) => log.status === 'failed')).toBe(true);
        expect(result.current.hasMore).toBe(true);
    });

    it('reads at least one page on a reload', async () => {
        fs.getDocs.mockResolvedValue(snapshot(logDocs(0, 3)));
        const { result, rerender } = renderLogs({ refreshKey: 0 });
        await waitFor(() => expect(result.current.logs).toHaveLength(3));

        rerender({ companyId: 'co-1', sessionId: 's-1', refreshKey: 1 });
        await waitFor(() => expect(fs.getDocs).toHaveBeenCalledTimes(2));
        expect(readLimits()).toEqual([200, 200]);
    });

    it('drops a page that lands after a reload started', async () => {
        fs.getDocs.mockResolvedValueOnce(snapshot(logDocs(0, 200)));
        fs.getCountFromServer.mockResolvedValue(countOf(450));
        const { result, rerender } = renderLogs({ refreshKey: 0 });
        await waitFor(() => expect(result.current.hasMore).toBe(true));

        const page = deferred();
        fs.getDocs
            .mockReturnValueOnce(page.promise)
            .mockResolvedValueOnce(snapshot(logDocs(0, 200, 'failed')));
        act(() => { result.current.loadMore(); });
        rerender({ companyId: 'co-1', sessionId: 's-1', refreshKey: 1 });
        await waitFor(() => expect(result.current.logs[0].status).toBe('failed'));

        await act(async () => { page.resolve(snapshot(logDocs(200, 200))); });
        expect(result.current.logs).toHaveLength(200);
        expect(result.current.loadMoreFailed).toBe(false);
    });
});
