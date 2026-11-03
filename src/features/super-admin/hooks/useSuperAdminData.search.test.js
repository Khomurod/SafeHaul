/**
 * The owner panel's lists show the newest read only. A search, a recent-data
 * read or a Load More page that answers after a newer read began changes
 * nothing, and neither does an answer for text no longer in the search box.
 *
 * Every read here answers through a deferred the test holds and resolves, so an
 * older read can be made to answer after a newer one.
 *
 * All ids and names below are synthetic test fixtures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

// Reads the test answers itself, by key: a search by its lowercased term,
// `recent` for the recent data, `page` for a Load More page, `members` for the
// memberships of a users page. A read waits on the one held when it starts;
// every other read answers at once.
const held = new Map();
function hold(key) {
    const gate = deferred();
    held.set(key, gate);
    return gate;
}
/** Answers the read held under `key`, with a label for recent data. */
function release(key, value) {
    held.get(key).resolve(value);
    held.delete(key);
}
/** A recent-data answer that cannot be processed: the read's own catch runs. */
const BROKEN = 'broken';

function snap(docs) {
    return { docs, empty: docs.length === 0, forEach: (cb) => docs.forEach(cb) };
}
function record(id, name) {
    return {
        id,
        data: () => ({ companyName: name, name, createdAt: { seconds: 1 } }),
        ref: { parent: { parent: { id: 'co-parent' } } },
    };
}
function records(prefix, n) {
    return Array.from({ length: n }, (_, i) => record(`${prefix}-${i}`, `${prefix} ${i}`));
}

const getDocs = vi.fn(async (target) => {
    const parts = target?.parts || [];
    const source = target?.__coll || parts.find((p) => p?.__coll)?.__coll || parts.find((p) => p?.__group)?.__group;
    const term = parts.find((p) => p?.__op === 'where' && p.a[1] === '>=')?.a[2];
    const size = parts.find((p) => p?.__op === 'limit')?.n ?? 20;
    if (source === 'memberships') {
        await held.get('members')?.promise;
        return snap([]);
    }
    if (parts.some((p) => p?.__op === 'startAfter')) {
        await held.get('page')?.promise;
        return snap(records(`page-${source}`, size));
    }
    if (term !== undefined) {
        await held.get(term.toLowerCase())?.promise;
        return snap([record(`${source}-${term.toLowerCase()}`, `${term} Freight`)]);
    }
    const label = (await held.get('recent')?.promise) ?? 'recent';
    if (label === BROKEN) return {};
    return snap(records(`${label}-${source}`, size));
});

vi.mock('firebase/firestore', () => ({
    collection: (_db, name) => ({ __coll: name }),
    collectionGroup: (_db, name) => ({ __group: name }),
    orderBy: (...a) => ({ __op: 'orderBy', a }),
    limit: (n) => ({ __op: 'limit', n }),
    where: (...a) => ({ __op: 'where', a }),
    startAfter: (cursor) => ({ __op: 'startAfter', cursor }),
    query: (...parts) => ({ __query: true, parts }),
    getDocs: (...a) => getDocs(...a),
    getCountFromServer: async () => ({ data: () => ({ count: 1 }) }),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
const showError = vi.fn();
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showError }),
}));

import { useSuperAdminData } from './useSuperAdminData';

const NO_ERRORS = {
    companies: false, users: false, apps: false,
    companyCount: false, userCount: false, appCount: false, leadCount: false,
};
const ids = (list) => list.map((item) => item.id);
const RECENT_COMPANIES = Array.from({ length: 20 }, (_, i) => `recent-companies-${i}`);
const FRESH_COMPANIES = RECENT_COMPANIES.map((id) => id.replace('recent', 'fresh'));
const pageReads = () => getDocs.mock.calls.filter(([target]) => (target?.parts || []).some((p) => p?.__op === 'startAfter'));

async function mountLoaded() {
    const hook = renderHook(() => useSuperAdminData());
    await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 3000 });
    expect(ids(hook.result.current.companyList)).toEqual(RECENT_COMPANIES);
    return hook;
}

/** Lets every answer already released run to its last state update. */
async function flush() {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
}
const type = (result, text) => act(() => result.current.setSearchQuery(text));
const pause = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); await flush(); });
const answer = (key, value) => act(async () => { release(key, value); await flush(); });

beforeEach(() => {
    vi.resetAllMocks();
    held.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    vi.useRealTimers();
});

describe('useSuperAdminData — the newest search shows', () => {
    it('shows the newest search when an older one answers last', async () => {
        const { result } = await mountLoaded();
        vi.useFakeTimers();
        hold('ab');
        hold('abc');
        type(result, 'Ab');
        await pause(600);
        type(result, 'Abc');
        await pause(600);

        await answer('abc');
        await answer('ab');

        expect(ids(result.current.companyList)).toEqual(['companies-abc']);
        expect(ids(result.current.userList)).toEqual(['users-abc']);
        expect(ids(result.current.allApplications)).toEqual(['leads-abc']);
        expect(result.current.loading).toBe(false);
    });

    it('shows the recent data after the search is cleared, even when the search answers later', async () => {
        const { result } = await mountLoaded();
        vi.useFakeTimers();
        hold('ab');
        type(result, 'Ab');
        await pause(600);
        type(result, '');
        await pause(600);

        await answer('ab');

        expect(ids(result.current.companyList)).toEqual(RECENT_COMPANIES);
        expect(result.current.loading).toBe(false);
    });

    it('stays loading until the newest search answers', async () => {
        const { result } = await mountLoaded();
        vi.useFakeTimers();
        hold('ab');
        hold('abc');
        type(result, 'Ab');
        await pause(600);
        type(result, 'Abc');
        await pause(600);

        await answer('ab');
        expect(result.current.loading).toBe(true);
        expect(ids(result.current.companyList)).toEqual(RECENT_COMPANIES);

        await answer('abc');
        expect(result.current.loading).toBe(false);
        expect(ids(result.current.companyList)).toEqual(['companies-abc']);
    });

    it('drops an answer for text no longer in the box, during the pause before the next search', async () => {
        const { result } = await mountLoaded();
        vi.useFakeTimers();
        hold('ab');
        type(result, 'Ab');
        await pause(600);
        type(result, 'Abc');
        await pause(300);

        await answer('ab');
        expect(ids(result.current.companyList)).toEqual(RECENT_COMPANIES);

        await pause(300);
        expect(ids(result.current.companyList)).toEqual(['companies-abc']);
        expect(result.current.loading).toBe(false);
    });
});

describe('useSuperAdminData — the box changed and cleared within the pause', () => {
    it('drops a search that answers while the box is changed and then cleared', async () => {
        const { result } = await mountLoaded();
        vi.useFakeTimers();
        hold('ab');
        type(result, 'Ab');
        await pause(600);
        type(result, 'Abc');
        await pause(200);
        type(result, '');
        await pause(200);

        await answer('ab');
        expect(ids(result.current.companyList)).toEqual(RECENT_COMPANIES);

        await pause(400);
        expect(ids(result.current.companyList)).toEqual(RECENT_COMPANIES);
        expect(result.current.loading).toBe(false);
    });

    // The box ends on the text the lists were being read for. The read in
    // flight was dropped by the change, so the lists are read again: they still
    // show that text's answer, and loading ends.
    it('reads the recent data again when the box is changed and cleared while they load', async () => {
        const { result } = await mountLoaded();
        vi.useFakeTimers();
        hold('recent');
        act(() => { result.current.refreshData(); });
        type(result, 'Ab');
        await pause(200);
        type(result, '');
        await pause(600);

        await answer('recent', 'fresh');

        expect(ids(result.current.companyList)).toEqual(FRESH_COMPANIES);
        expect(result.current.loading).toBe(false);
    });

    it('reads a search again when the box goes back to it within the pause', async () => {
        const { result } = await mountLoaded();
        vi.useFakeTimers();
        hold('ab');
        type(result, 'Ab');
        await pause(600);
        type(result, 'Abc');
        await pause(200);
        type(result, 'Ab');
        await pause(600);

        await answer('ab');

        expect(ids(result.current.companyList)).toEqual(['companies-ab']);
        expect(result.current.loading).toBe(false);
    });
});

describe('useSuperAdminData — an older recent-data read', () => {
    it('keeps an older read\'s answer out when it answers after the newest', async () => {
        const { result } = await mountLoaded();
        const olderGate = hold('recent');
        let older;
        act(() => { older = result.current.refreshData(); });
        hold('recent');
        let newer;
        act(() => { newer = result.current.refreshData(); });

        await act(async () => { release('recent', 'fresh'); await newer; });
        expect(ids(result.current.companyList)).toEqual(FRESH_COMPANIES);
        expect(result.current.loading).toBe(false);

        await act(async () => { olderGate.resolve('stale'); await older; });
        expect(ids(result.current.companyList)).toEqual(FRESH_COMPANIES);
        expect(result.current.loading).toBe(false);
    });

    it('stays loading when the older read answers first', async () => {
        const { result } = await mountLoaded();
        const olderGate = hold('recent');
        let older;
        act(() => { older = result.current.refreshData(); });
        hold('recent');
        let newer;
        act(() => { newer = result.current.refreshData(); });

        await act(async () => { olderGate.resolve('stale'); await older; });
        expect(result.current.loading).toBe(true);
        expect(ids(result.current.companyList)).toEqual(RECENT_COMPANIES);

        await act(async () => { release('recent', 'fresh'); await newer; });
        expect(result.current.loading).toBe(false);
        expect(ids(result.current.companyList)).toEqual(FRESH_COMPANIES);
    });

    it('flags no error and shows no toast when an older read fails after a newer one answered', async () => {
        const { result } = await mountLoaded();
        const olderGate = hold('recent');
        let older;
        act(() => { older = result.current.refreshData(); });
        hold('recent');
        let newer;
        act(() => { newer = result.current.refreshData(); });

        await act(async () => { release('recent', 'fresh'); await newer; });
        await act(async () => { olderGate.resolve(BROKEN); await older; });

        expect(result.current.statsError).toEqual(NO_ERRORS);
        expect(showError).not.toHaveBeenCalled();
        expect(result.current.loading).toBe(false);
        expect(ids(result.current.companyList)).toEqual(FRESH_COMPANIES);
    });
});

describe('useSuperAdminData — Load More and a newer read', () => {
    it('reads no page while a read is loading, and reads one again once it answers', async () => {
        const { result } = await mountLoaded();
        hold('recent');
        let refresh;
        act(() => {
            refresh = result.current.refreshData();
            result.current.loadMore('companies');
        });
        expect(pageReads()).toHaveLength(0);

        await act(async () => { release('recent'); await refresh; });
        await act(async () => { await result.current.loadMore('companies'); });
        expect(pageReads()).toHaveLength(1);
        expect(result.current.companyList).toHaveLength(40);
    });

    it.each([
        ['companies', 'companyList', ['companies-ab']],
        ['applications', 'allApplications', ['leads-ab']],
    ])('drops a %s page that answers after a newer search', async (kind, list, expected) => {
        const { result } = await mountLoaded();
        vi.useFakeTimers();
        hold('page');
        let more;
        act(() => { more = result.current.loadMore(kind); });
        type(result, 'Ab');
        await pause(600);
        expect(ids(result.current[list])).toEqual(expected);

        await act(async () => { release('page'); await more; });

        expect(ids(result.current[list])).toEqual(expected);
        expect(result.current.loadingMore[kind]).toBe(false);
    });

    it('drops a users page whose memberships answer after a newer search', async () => {
        const { result } = await mountLoaded();
        expect(result.current.hasMoreUsers).toBe(true);
        vi.useFakeTimers();
        hold('members');
        let more;
        act(() => { more = result.current.loadMore('users'); });
        await act(async () => { await flush(); });
        type(result, 'Ab');
        await pause(600);
        expect(ids(result.current.userList)).toEqual(['users-ab']);

        await act(async () => { release('members'); await more; });

        expect(ids(result.current.userList)).toEqual(['users-ab']);
        expect(result.current.loadingMore.users).toBe(false);
    });

    it('shows no error for a page that fails after a newer search', async () => {
        const { result } = await mountLoaded();
        vi.useFakeTimers();
        const page = hold('page');
        let more;
        act(() => { more = result.current.loadMore('companies'); });
        type(result, 'Ab');
        await pause(600);

        await act(async () => { page.reject(new Error('simulated page failure')); await more; });

        expect(showError).not.toHaveBeenCalled();
        expect(result.current.loadingMore.companies).toBe(false);
        expect(ids(result.current.companyList)).toEqual(['companies-ab']);
    });
});
