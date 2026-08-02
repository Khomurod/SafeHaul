/**
 * Regression proof for the "Load More" concurrency defect on the Super Admin
 * database pagination.
 *
 * The visible "Load More from Database" button (Unified Driver DB and Companies)
 * called `loadMore(type)` with no in-flight guard. Two fast activations both
 * read the same (stale) Firestore cursors, fetched the same batch, and appended
 * it twice — duplicate records and duplicate React keys. The fix guards at the
 * handler level in the hook, so the proof lives here, not only in the button's
 * disabled state.
 *
 * All ids and names below are synthetic test fixtures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// --- Firestore query-builder markers so getDocs can tell calls apart ---
const collection = vi.fn((_db, name) => ({ __coll: name }));
const collectionGroup = vi.fn((_db, name) => ({ __group: name }));
const orderBy = vi.fn((...a) => ({ __op: 'orderBy', a }));
const limit = vi.fn((n) => ({ __op: 'limit', n }));
const where = vi.fn((...a) => ({ __op: 'where', a }));
const startAfter = vi.fn((cursor) => ({ __op: 'startAfter', cursor }));
const query = vi.fn((...parts) => ({ __query: true, parts }));

let loadMoreFetches = 0;
let failNextLoadMoreFetch = false;
// When set, load-more fetches block on this promise so a test can observe the
// in-flight loading state after React has committed it.
let loadMoreGate = null;

function snapFromIds(ids) {
    const docs = ids.map((id) => ({
        id,
        data: () => ({ createdAt: { seconds: 1 }, companyName: `Name-${id}`, status: 'New' }),
        ref: { parent: { parent: { id: `co-${id}` } } },
    }));
    return { docs, empty: docs.length === 0, forEach: (cb) => docs.forEach(cb) };
}

const getDocs = vi.fn(async (q) => {
    const parts = q?.parts || [];
    const startAfterPart = parts.find((p) => p?.__op === 'startAfter');
    const groupPart = parts.find((p) => p?.__group);
    const collPart = parts.find((p) => p?.__coll);
    const wherePart = parts.find((p) => p?.__op === 'where');

    // Membership lookups during the initial load — irrelevant here.
    if (wherePart) return snapFromIds([]);

    if (startAfterPart) {
        loadMoreFetches += 1;
        if (loadMoreGate) await loadMoreGate;
        if (failNextLoadMoreFetch) {
            failNextLoadMoreFetch = false;
            throw new Error('simulated load-more failure');
        }
        // Deterministic per (collection, cursor): the same cursor yields the
        // same ids, exactly as a real repeated fetch would — so a lost guard
        // reappends identical records and the duplicate assertion catches it.
        const group = groupPart?.__group || collPart?.__coll || 'x';
        const cursorId = startAfterPart.cursor?.id ?? 'none';
        return snapFromIds(Array.from({ length: 15 }, (_, i) => `${group}-after-${cursorId}-${i}`));
    }

    // Initial paginated load — companies/users/leads/applications, no cursor.
    // Return a full page (matching the query's limit) so every `hasMore*` flag
    // is true and both pagination paths can be exercised.
    const key = groupPart?.__group || collPart?.__coll || 'init';
    const limitPart = parts.find((p) => p?.__op === 'limit');
    const n = limitPart?.n ?? 15;
    return snapFromIds(Array.from({ length: n }, (_, i) => `${key}-init-${i}`));
});

const getCountFromServer = vi.fn(async () => ({ data: () => ({ count: 0 }) }));

vi.mock('firebase/firestore', () => ({
    collection: (...a) => collection(...a),
    collectionGroup: (...a) => collectionGroup(...a),
    orderBy: (...a) => orderBy(...a),
    limit: (...a) => limit(...a),
    where: (...a) => where(...a),
    startAfter: (...a) => startAfter(...a),
    query: (...a) => query(...a),
    getDocs: (...a) => getDocs(...a),
    getCountFromServer: (...a) => getCountFromServer(...a),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));

const showError = vi.fn();
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showError }),
}));
vi.mock('@/context/dataContext/sessionKeys', () => ({
    SESSION_KEYS: { PLATFORM_STATS: 'test-platform-stats' },
}));

import { useSuperAdminData } from './useSuperAdminData';

/** Mounts the hook and waits for the debounced initial load to settle. */
async function mountLoaded() {
    const hook = renderHook(() => useSuperAdminData());
    await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 3000 });
    // The initial load must have set cursors and flagged more available, or the
    // loadMore guard's early-returns would mask the concurrency behaviour.
    expect(hook.result.current.hasMoreApps).toBe(true);
    return hook;
}

beforeEach(() => {
    vi.clearAllMocks();
    loadMoreFetches = 0;
    failNextLoadMoreFetch = false;
    loadMoreGate = null;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useSuperAdminData — Load More concurrency guard', () => {
    it('fetches once for two rapid activations and appends no duplicate records', async () => {
        const { result } = await mountLoaded();
        const before = result.current.allApplications.length;

        await act(async () => {
            // Two activations in the same tick, before the first resolves.
            const p1 = result.current.loadMore('applications');
            const p2 = result.current.loadMore('applications');
            await Promise.all([p1, p2]);
        });

        // One round fetches leads + applications = exactly two getDocs. A lost
        // guard would run the second activation too, giving four.
        expect(loadMoreFetches).toBe(2);

        // Exactly one batch (leads 15 + apps 15) appended, and every id unique —
        // no duplicate React keys.
        expect(result.current.allApplications.length).toBe(before + 30);
        const ids = result.current.allApplications.map((a) => a.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('reflects an in-flight load through loadingMore and clears it when done', async () => {
        const { result } = await mountLoaded();

        // Hold the fetch open so the in-flight state stays observable.
        let release;
        loadMoreGate = new Promise((r) => { release = r; });

        let pending;
        act(() => { pending = result.current.loadMore('applications'); });

        // The button consumes this flag to disable itself and show "Loading…".
        await waitFor(() => expect(result.current.loadingMore.applications).toBe(true));

        release();
        await act(async () => { await pending; });

        expect(result.current.loadingMore.applications).toBe(false);
    });

    it('releases the guard after a failure so a retry can fetch again', async () => {
        const { result } = await mountLoaded();
        const before = result.current.allApplications.length;

        failNextLoadMoreFetch = true;
        await act(async () => {
            await result.current.loadMore('applications');
        });

        expect(showError).toHaveBeenCalledWith('Failed to load more applications.');
        expect(result.current.loadingMore.applications).toBe(false);
        // Nothing appended on the failed attempt.
        expect(result.current.allApplications.length).toBe(before);

        // The retry succeeds because the finally released the in-flight guard.
        await act(async () => {
            await result.current.loadMore('applications');
        });
        expect(result.current.allApplications.length).toBe(before + 30);
    });

    it('guards the companies pagination the same way (shared guard)', async () => {
        // Companies (CompaniesView) uses the same shared loadMore, so the same
        // handler-level guard protects it against overlapping loads.
        const { result } = await mountLoaded();
        expect(result.current.hasMoreCompanies).toBe(true);
        const before = result.current.companyList.length;

        await act(async () => {
            const p1 = result.current.loadMore('companies');
            const p2 = result.current.loadMore('companies');
            await Promise.all([p1, p2]);
        });

        // Companies is a single getDocs per round, so exactly one fetch — not two.
        expect(loadMoreFetches).toBe(1);
        // One batch appended (the fixture returns 15 per load-more page), all
        // ids unique — no duplicate rows, no duplicate React keys.
        expect(result.current.companyList.length).toBe(before + 15);
        const ids = result.current.companyList.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('lets companies and applications load concurrently — the guard is per-type', async () => {
        const { result } = await mountLoaded();
        await act(async () => {
            // Different types must not block each other.
            await Promise.all([
                result.current.loadMore('companies'),
                result.current.loadMore('applications'),
            ]);
        });
        // companies (1) + applications leads+apps (2) = 3 distinct fetches.
        expect(loadMoreFetches).toBe(3);
    });
});
