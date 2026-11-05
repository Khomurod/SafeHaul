import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Query builders return inspectable objects, so each listener's query can be
// asserted; `onSnapshot` hands its callbacks to the test, and the server
// aggregates answer from `server`. All data is artificial.
const fs = vi.hoisted(() => ({
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    sum: vi.fn(),
    onSnapshot: vi.fn(),
    getCountFromServer: vi.fn(),
    getAggregateFromServer: vi.fn(),
}));
const e2eParams = vi.hoisted(() => ({ current: {} }));

vi.mock('firebase/firestore', () => fs);
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({
    isE2ETestMode: true,
    getE2EQueryParam: (name, fallback = '') => e2eParams.current[name] ?? fallback,
}));

import { CAMPAIGN_LIST_PAGE_SIZE, useCampaignLists } from './useCampaignLists';

const DRAFTS_PATH = 'companies/co-1/campaign_drafts';
const SESSIONS_PATH = 'companies/co-1/bulk_sessions';

let listeners;
let server;

beforeEach(() => {
    vi.resetAllMocks();
    fs.collection.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    fs.query.mockImplementation((ref, ...constraints) => ({ ref, constraints }));
    fs.where.mockImplementation((field, op, value) => ({ kind: 'where', field, op, value }));
    fs.orderBy.mockImplementation((field, direction) => ({ kind: 'orderBy', field, direction }));
    fs.limit.mockImplementation((n) => ({ kind: 'limit', n }));
    fs.sum.mockImplementation((field) => ({ kind: 'sum', field }));
    listeners = [];
    fs.onSnapshot.mockImplementation((q, next, fail) => {
        const unsubscribe = vi.fn();
        listeners.push({ q, next, fail, unsubscribe });
        return unsubscribe;
    });
    server = { counts: {}, launchedDrafts: 0, outreach: 0, outreachError: null };
    // The count of launched drafts is the one filtered on `launchedAt`; every other count is by path.
    const countsLaunched = (q) => q.constraints.some((c) => c.kind === 'where' && c.field === 'launchedAt');
    fs.getCountFromServer.mockImplementation(async (q) => ({
        data: () => ({ count: countsLaunched(q) ? server.launchedDrafts : (server.counts[q.ref.path] ?? 0) }),
    }));
    fs.getAggregateFromServer.mockImplementation(async () => {
        if (server.outreachError) throw server.outreachError;
        return { data: () => ({ outreach: server.outreach }) };
    });
    e2eParams.current = {};
});

afterEach(() => {
    vi.useRealTimers();
});

/** Which listener a query is: the live sessions (filtered by status), the drafts or the history window. */
const kindOf = (q) => {
    if (q.constraints.some((c) => c.kind === 'where')) return 'live';
    return q.ref.ref.path === DRAFTS_PATH ? 'drafts' : 'history';
};
const listenersOf = (kind) => listeners.filter((listener) => kindOf(listener.q) === kind);
const latest = (kind) => listenersOf(kind).at(-1);
const toDoc = ({ id, ...data }) => ({ id, data: () => data });
const emit = (kind, items) => act(() => { latest(kind).next({ docs: items.map(toDoc) }); });
const fail = (kind) => act(() => { latest(kind).fail(new Error('unavailable')); });
const ids = (items) => items.map((item) => item.id);

const at = (millis) => ({ toMillis: () => millis });
const session = (id, overrides = {}) => ({
    id,
    name: `Artificial Campaign ${id}`,
    status: 'completed',
    createdAt: at(Date.UTC(2026, 5, 1)),
    progress: { processedCount: 2, totalCount: 2 },
    ...overrides,
});
const sessions = (n, prefix = 's', overrides = {}) => Array.from({ length: n }, (_, i) => session(`${prefix}-${i}`, overrides));
const drafts = (n) => Array.from({ length: n }, (_, i) => ({ id: `d-${i}`, name: `Artificial Draft ${i}`, status: 'draft' }));

const renderLists = (props = {}) => renderHook((p) => useCampaignLists(p), {
    initialProps: { companyId: 'co-1', enabled: true, ...props },
});

/** All three listeners answer: the drafts, the history and the live sessions. */
async function answer({ draftItems = [], historyItems = [], liveItems = [] } = {}) {
    await emit('drafts', draftItems);
    await emit('history', historyItems);
    await emit('live', liveItems);
}

describe('useCampaignLists — the reads', () => {
    it('lists the newest 50 drafts and sessions, and every live session with no limit', () => {
        renderLists();

        expect(listeners).toHaveLength(3);
        expect(CAMPAIGN_LIST_PAGE_SIZE).toBe(50);
        expect(latest('drafts').q).toEqual({
            ref: { ref: { path: DRAFTS_PATH }, constraints: [{ kind: 'orderBy', field: 'updatedAt', direction: 'desc' }] },
            constraints: [{ kind: 'limit', n: 50 }],
        });
        expect(latest('history').q).toEqual({
            ref: { ref: { path: SESSIONS_PATH }, constraints: [{ kind: 'orderBy', field: 'createdAt', direction: 'desc' }] },
            constraints: [{ kind: 'limit', n: 50 }],
        });
        expect(latest('live').q).toEqual({
            ref: { path: SESSIONS_PATH },
            constraints: [{ kind: 'where', field: 'status', op: 'in', value: ['active', 'queued', 'scheduled', 'paused'] }],
        });
        expect(fs.limit).toHaveBeenCalledTimes(2);
    });

    it('reads nothing while turned off or without a company', () => {
        const { result } = renderLists({ enabled: false });
        renderLists({ companyId: undefined });

        expect(fs.onSnapshot).not.toHaveBeenCalled();
        expect(fs.getCountFromServer).not.toHaveBeenCalled();
        expect(fs.getAggregateFromServer).not.toHaveBeenCalled();
        expect(result.current.drafts).toMatchObject({ items: [], isLoading: false, error: null, hasMore: false });
        expect(result.current.sessions).toMatchObject({ items: [], isLoading: false, error: null, hasMore: false });
    });

    it('starts again, with no rows, for another company', async () => {
        const { result, rerender } = renderLists();
        await answer({ historyItems: sessions(2), liveItems: [session('old-live', { status: 'active' })] });
        expect(result.current.sessions.items).toHaveLength(3);

        rerender({ companyId: 'co-2', enabled: true });

        expect(result.current.sessions.items).toEqual([]);
        expect(result.current.sessions.isLoading).toBe(true);
        expect(listenersOf('live')).toHaveLength(2);
        expect(latest('live').q.ref).toEqual({ path: 'companies/co-2/bulk_sessions' });
        expect(listenersOf('live')[0].unsubscribe).toHaveBeenCalledTimes(1);
    });
});

describe('useCampaignLists — live sessions', () => {
    it('lists all 120 live sessions older than the window and counts them', async () => {
        server.counts[SESSIONS_PATH] = 170;
        const { result } = renderLists();
        const old = sessions(120, 'live', { status: 'active', createdAt: at(Date.UTC(2025, 0, 1)) });
        await answer({ historyItems: sessions(50), liveItems: old });

        expect(result.current.sessions.items).toHaveLength(170);
        expect(ids(result.current.sessions.items).slice(50)).toEqual(ids(old));
        expect(result.current.liveCount).toBe(120);
    });

    it('lists each session once, keeps the history order and appends older live ones newest first', async () => {
        const { result } = renderLists();
        const history = [
            session('h-3'),
            session('h-1', { status: 'active', progress: { processedCount: 7, totalCount: 9 } }),
            session('h-2'),
        ];
        const live = [
            session('h-1', { status: 'paused' }),
            session('only-to-date', { status: 'active', createdAt: { toDate: () => new Date(Date.UTC(2025, 2, 1)) } }),
            session('to-millis', { status: 'queued', createdAt: at(Date.UTC(2025, 4, 1)) }),
            session('seconds', { status: 'scheduled', createdAt: { seconds: Date.UTC(2025, 3, 1) / 1000 } }),
            session('no-date', { status: 'paused', createdAt: undefined }),
        ];
        await answer({ historyItems: history, liveItems: live });

        expect(ids(result.current.sessions.items)).toEqual([
            'h-3', 'h-1', 'h-2', 'to-millis', 'seconds', 'only-to-date', 'no-date',
        ]);
        // The history's copy wins: it is the one the window keeps live.
        expect(result.current.sessions.items[1]).toMatchObject({ status: 'active', matchCount: 9 });
    });

    it('counts Live Campaigns from the merged sessions: active, queued and scheduled', async () => {
        const { result } = renderLists();
        await answer({
            historyItems: [session('a', { status: 'active' }), session('c', { status: 'completed' })],
            liveItems: [
                session('a', { status: 'active' }),
                session('q', { status: 'queued' }),
                session('s', { status: 'scheduled' }),
                session('p', { status: 'paused' }),
            ],
        });

        expect(result.current.liveCount).toBe(3);
    });

    it('maps a session for the cards as before', async () => {
        const { result } = renderLists();
        const created = at(1);
        await emit('history', [{
            id: 'mapped',
            name: 'Artificial',
            status: 'completed',
            createdAt: created,
            config: { method: 'email', message: 'Hi' },
            targetIds: ['a', 'b', 'c'],
        }]);

        expect(result.current.sessions.items[0]).toMatchObject({
            id: 'mapped',
            updatedAt: created,
            messageConfig: { method: 'email', message: 'Hi' },
            matchCount: 3,
        });
    });

    it('makes a failure of either sessions listener the sessions error, and retries both', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderLists();
        await answer({ historyItems: sessions(2) });
        await fail('live');

        expect(result.current.sessions.error).toBe('Campaigns could not be loaded.');
        expect(result.current.drafts.error).toBe(null);
        expect(consoleError).toHaveBeenCalledWith('Error loading live campaigns:', expect.any(Error));

        act(() => { result.current.sessions.retry(); });
        expect(result.current.sessions).toMatchObject({ error: null, isLoading: true });
        expect(listenersOf('history')).toHaveLength(2);
        expect(listenersOf('live')).toHaveLength(2);

        await emit('history', sessions(2));
        expect(result.current.sessions.isLoading).toBe(true);
        await emit('live', []);
        expect(result.current.sessions.isLoading).toBe(false);
        consoleError.mockRestore();
    });

    it('shows no Live Campaigns number when the live listener failed and the history is incomplete', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        server.counts[SESSIONS_PATH] = 80;
        const { result } = renderLists();
        await answer({ historyItems: sessions(50, 's', { status: 'active' }) });
        expect(result.current.liveCount).toBe(50);

        await fail('live');
        expect(result.current.liveCount).toBe(null);
        consoleError.mockRestore();
    });
});

describe('useCampaignLists — totals', () => {
    it('sums Total Outreach from the sessions while the history is complete, with no server read', async () => {
        const { result } = renderLists();
        await answer({
            historyItems: [
                session('a', { progress: { processedCount: 10 } }),
                session('b', { progress: { processedCount: 5 } }),
                session('c', { progress: undefined }),
            ],
        });
        await act(async () => {});

        expect(result.current.totalOutreach).toBe(15);
        expect(result.current.sessions).toMatchObject({ hasMore: false, total: null });
        expect(fs.getAggregateFromServer).not.toHaveBeenCalled();
        expect(fs.getCountFromServer).not.toHaveBeenCalled();
    });

    it('reads Total Outreach as a server sum over every session once the history is full', async () => {
        server.counts[SESSIONS_PATH] = 75;
        server.outreach = 9876;
        const { result } = renderLists();
        await answer({ historyItems: sessions(50) });

        await waitFor(() => expect(result.current.totalOutreach).toBe(9876));
        expect(fs.getAggregateFromServer).toHaveBeenCalledWith(
            { ref: { path: SESSIONS_PATH }, constraints: [] },
            { outreach: { kind: 'sum', field: 'progress.processedCount' } },
        );
    });

    it('has no Total Outreach, never the partial sum, when the server sum fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        server.counts[SESSIONS_PATH] = 75;
        server.outreachError = new Error('unavailable');
        const { result } = renderLists();
        await answer({ historyItems: sessions(50) });

        await waitFor(() => expect(fs.getAggregateFromServer).toHaveBeenCalled());
        await act(async () => {});
        expect(result.current.totalOutreach).toBe(null);
        consoleError.mockRestore();
    });

    it('has no Total Outreach when the history listener failed', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderLists();
        await emit('live', [session('a', { status: 'active', progress: { processedCount: 4 } })]);
        await fail('history');

        expect(result.current.sessions.error).toBe('Campaigns could not be loaded.');
        expect(result.current.totalOutreach).toBe(null);
        consoleError.mockRestore();
    });

    it('counts a list on the server only while it is full', async () => {
        server.counts[DRAFTS_PATH] = 75;
        const { result } = renderLists();
        await answer({ draftItems: drafts(50), historyItems: sessions(3) });

        await waitFor(() => expect(result.current.drafts.total).toBe(75));
        expect(result.current.drafts.hasMore).toBe(true);
        // Only the drafts are counted: all of them, less the launched ones.
        expect(fs.getCountFromServer.mock.calls.map(([q]) => q.ref.path)).toEqual([DRAFTS_PATH, DRAFTS_PATH]);
        expect(fs.getCountFromServer).toHaveBeenCalledWith({
            ref: { path: DRAFTS_PATH },
            constraints: [{ kind: 'orderBy', field: 'updatedAt', direction: 'desc' }],
        });
        expect(result.current.sessions).toMatchObject({ hasMore: false, total: null });
    });

    it('offers no Load more when exactly 50 of 50 are listed', async () => {
        server.counts[DRAFTS_PATH] = 50;
        const { result } = renderLists();
        await answer({ draftItems: drafts(50) });

        await waitFor(() => expect(fs.getCountFromServer).toHaveBeenCalled());
        await waitFor(() => expect(result.current.drafts.hasMore).toBe(false));
        expect(result.current.drafts.total).toBe(null);
    });

    it('re-reads Total Outreach within 2 s of a change to a live session older than the window', async () => {
        vi.useFakeTimers();
        server.counts[SESSIONS_PATH] = 75;
        server.outreach = 100;
        const { result } = renderLists();
        const old = session('old', { status: 'active', createdAt: at(1), progress: { processedCount: 1 } });
        await answer({ historyItems: sessions(50), liveItems: [old] });
        await act(async () => {});
        expect(fs.getAggregateFromServer).toHaveBeenCalledTimes(1);
        expect(result.current.totalOutreach).toBe(100);

        server.outreach = 101;
        await emit('live', [{ ...old, progress: { processedCount: 2 } }]);
        expect(fs.getAggregateFromServer).toHaveBeenCalledTimes(1);
        await act(async () => { vi.advanceTimersByTime(2000); });
        await act(async () => {});

        expect(fs.getAggregateFromServer).toHaveBeenCalledTimes(2);
        expect(result.current.totalOutreach).toBe(101);
    });
});

// A launched draft is kept as the campaign's record (`launchedAt`, `sessionId`)
// but is no longer a draft: Drafts leaves it out, and so does its count.
describe('useCampaignLists — launched drafts', () => {
    const launched = (id, launchedAt = at(Date.UTC(2026, 10, 1))) => ({
        id, name: `Artificial Launched ${id}`, status: 'draft', launchedAt, sessionId: `session-${id}`,
    });

    it('leaves launched drafts out of Drafts, also while the launch time is still pending', async () => {
        const { result } = renderLists();

        await answer({ draftItems: [drafts(1)[0], launched('sent'), launched('pending', null), drafts(2)[1]] });

        expect(ids(result.current.drafts.items)).toEqual(['d-0', 'd-1']);
        expect(latest('drafts').q.ref.constraints).toEqual([{ kind: 'orderBy', field: 'updatedAt', direction: 'desc' }]);
    });

    it('counts Drafts on the server without the launched ones', async () => {
        server.counts[DRAFTS_PATH] = 75;
        server.launchedDrafts = 20;
        const { result } = renderLists();

        await answer({ draftItems: [...drafts(45), ...['a', 'b', 'c', 'd', 'e'].map((id) => launched(id))] });

        await waitFor(() => expect(result.current.drafts.total).toBe(55));
        expect(result.current.drafts.items).toHaveLength(45);
        expect(result.current.drafts.hasMore).toBe(true);
        expect(fs.getCountFromServer).toHaveBeenCalledWith({
            ref: { path: DRAFTS_PATH },
            constraints: [{ kind: 'where', field: 'launchedAt', op: '!=', value: null }],
        });
    });

    it('offers Load more when the whole window is launched but older drafts remain', async () => {
        server.counts[DRAFTS_PATH] = 53;
        server.launchedDrafts = 50;
        const { result } = renderLists();

        await answer({ draftItems: Array.from({ length: 50 }, (_, i) => launched(`l-${i}`)) });

        await waitFor(() => expect(result.current.drafts.total).toBe(3));
        expect(result.current.drafts).toMatchObject({ items: [], hasMore: true });
    });

    it('is complete when every draft beyond the window is launched too', async () => {
        server.counts[DRAFTS_PATH] = 60;
        server.launchedDrafts = 60;
        const { result } = renderLists();

        await answer({ draftItems: Array.from({ length: 50 }, (_, i) => launched(`l-${i}`)) });

        await waitFor(() => expect(result.current.drafts.hasMore).toBe(false));
        expect(result.current.drafts).toMatchObject({ items: [], total: null });
    });
});

describe('useCampaignLists — Load more', () => {
    it('grows the drafts window to limit(100) and keeps the rows until it answers', async () => {
        server.counts[DRAFTS_PATH] = 75;
        const { result } = renderLists();
        await answer({ draftItems: drafts(50) });
        await waitFor(() => expect(result.current.drafts.total).toBe(75));

        act(() => { result.current.drafts.loadMore(); });

        expect(latest('drafts').q.constraints).toEqual([{ kind: 'limit', n: 100 }]);
        expect(result.current.drafts).toMatchObject({ isLoadingMore: true, hasMore: true });
        expect(result.current.drafts.items).toHaveLength(50);

        await emit('drafts', drafts(75));
        expect(result.current.drafts).toMatchObject({ isLoadingMore: false, hasMore: false, total: null });
        expect(result.current.drafts.items).toHaveLength(75);
    });

    it('grows the sessions window to limit(100) and then sums locally again', async () => {
        server.counts[SESSIONS_PATH] = 60;
        server.outreach = 999;
        const { result } = renderLists();
        await answer({ historyItems: sessions(50) });
        await waitFor(() => expect(result.current.totalOutreach).toBe(999));

        act(() => { result.current.sessions.loadMore(); });
        expect(latest('history').q.constraints).toEqual([{ kind: 'limit', n: 100 }]);

        await emit('history', sessions(60));
        expect(result.current.sessions).toMatchObject({ hasMore: false, isLoadingMore: false });
        expect(result.current.totalOutreach).toBe(120);
    });
});

describe('useCampaignLists — E2E fixtures', () => {
    it('serves the seeded draft and session and reads nothing (e2eCampaign=mock)', async () => {
        e2eParams.current = { e2eCampaign: 'mock' };
        const { result } = renderLists();
        await act(async () => {});

        expect(fs.onSnapshot).not.toHaveBeenCalled();
        expect(fs.getCountFromServer).not.toHaveBeenCalled();
        expect(fs.getAggregateFromServer).not.toHaveBeenCalled();
        expect(ids(result.current.drafts.items)).toEqual(['camp_e2e_seed']);
        expect(ids(result.current.sessions.items)).toEqual(['session_e2e_seed']);
        expect(result.current.drafts).toMatchObject({ isLoading: false, error: null, hasMore: false });
        expect(result.current.sessions).toMatchObject({ isLoading: false, error: null, hasMore: false });
        expect(result.current.liveCount).toBe(0);
        expect(result.current.totalOutreach).toBe(12);
    });

    it('serves 60 of each, 50 at a time, with totals over all 60 (e2eCampaignList=many)', async () => {
        e2eParams.current = { e2eCampaign: 'mock', e2eCampaignList: 'many' };
        const { result } = renderLists();

        expect(fs.onSnapshot).not.toHaveBeenCalled();
        expect(result.current.drafts).toMatchObject({ hasMore: true, total: 60 });
        expect(result.current.drafts.items).toHaveLength(50);
        expect(result.current.sessions).toMatchObject({ hasMore: true, total: 60 });
        expect(result.current.sessions.items).toHaveLength(50);
        expect(result.current.totalOutreach).toBe(600);
        expect(result.current.liveCount).toBe(0);

        act(() => { result.current.drafts.loadMore(); });
        expect(result.current.drafts.items).toHaveLength(60);
        expect(result.current.drafts.hasMore).toBe(false);
        expect(result.current.sessions.items).toHaveLength(50);

        act(() => { result.current.sessions.loadMore(); });
        expect(result.current.sessions.items).toHaveLength(60);
        expect(result.current.sessions.hasMore).toBe(false);
    });

    it('ignores e2eCampaignList without the mock', () => {
        e2eParams.current = { e2eCampaignList: 'many' };
        renderLists();
        expect(fs.onSnapshot).toHaveBeenCalledTimes(3);
    });
});
