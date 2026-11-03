/**
 * The candidate list's memoized table and toolbar redraw only when a prop they
 * take changes, so the hook hands them the same functions, and the same team,
 * from one render to the next: typing in the search (which changes only
 * `searchQuery`) must not give them new ones. What the functions do stays as
 * it was.
 *
 * All names, emails and ids below are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({
    // Held once, as DataContext holds the signed-in company: a profile built on
    // every call would make the team new on every render by itself.
    profile: {
        id: 'co-1',
        teamMembers: [
            { userId: 'uid-ann', name: 'Ann Admin', email: 'ann@example.com', role: 'company_admin' },
        ],
    },
    claims: { roles: { 'co-1': 'company_admin' } },
    reads: [],
}));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: fx.profile, currentUserClaims: fx.claims }),
}));
vi.mock('firebase/firestore', () => {
    const record = (kind) => (...args) => ({ kind, args });
    return {
        collection: (_db, ...path) => ({ path: path.join('/') }),
        query: (base, ...constraints) => ({ path: base.path, constraints }),
        where: record('where'),
        orderBy: record('orderBy'),
        limit: record('limit'),
        startAt: record('startAt'),
        startAfter: record('startAfter'),
        endAt: record('endAt'),
        endBefore: record('endBefore'),
        documentId: () => '__name__',
        doc: record('doc'),
        getDoc: async () => ({ exists: () => false }),
        getDocs: async (q) => {
            fx.reads.push({ kind: 'docs', path: q.path });
            // One record on every page, so a page has a cursor to go on from.
            return q.path === 'companies/co-1/applications'
                ? { docs: [{ id: `app-${fx.reads.length}`, data: () => ({ firstName: 'Ann', status: 'New' }) }] }
                : { docs: [] };
        },
        getCountFromServer: async (q) => {
            fx.reads.push({ kind: 'count', path: q.path });
            return { data: () => ({ count: 60 }) };
        },
    };
});
vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'uid-ann' } } }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));
vi.mock('@lib/runtime/dashboardRollup', () => ({ shouldPreferDashboardRollup: () => false }));

import { useCompanyDashboard } from './useCompanyDashboard';

const PROFILE = fx.profile;
const ADMIN = fx.claims;

afterEach(() => {
    fx.profile = PROFILE;
    fx.claims = ADMIN;
    fx.reads = [];
});

/** Renders the hook and waits until its first list and count reads have answered. */
async function settledDashboard() {
    const hook = renderHook(() => useCompanyDashboard('co-1'));
    await waitFor(() => expect(hook.result.current.totalCount).toBe(60));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
}

describe('useCompanyDashboard identities', () => {
    it('keeps setFilters, nextPage, prevPage and refreshData while the search is typed', async () => {
        const { result } = await settledDashboard();
        const before = result.current;

        act(() => result.current.setSearchQuery('m'));

        expect(result.current.searchQuery).toBe('m');
        expect(result.current.setFilters).toBe(before.setFilters);
        expect(result.current.nextPage).toBe(before.nextPage);
        expect(result.current.prevPage).toBe(before.prevPage);
        expect(result.current.refreshData).toBe(before.refreshData);
    });

    it('keeps an empty team the same array when the company document lists no team', async () => {
        // A recruiter may not list the memberships, so the team stays empty.
        fx.profile = { id: 'co-1' };
        fx.claims = { roles: { 'co-1': 'recruiter' } };
        const { result } = await settledDashboard();
        const team = result.current.teamMembers;

        act(() => result.current.setSearchQuery('m'));

        expect(result.current.searchQuery).toBe('m');
        expect(team).toEqual([]);
        expect(result.current.teamMembers).toBe(team);
    });
});

describe('useCompanyDashboard behaviour', () => {
    it('still sets a filter by key and value', async () => {
        const { result } = await settledDashboard();

        act(() => result.current.setFilters('state', 'Texas'));

        expect(result.current.filters.state).toBe('Texas');
        expect(result.current.filters.myAssignmentsOnly).toBe(false);
    });

    it('still moves to the next page and back, never below the first', async () => {
        const { result } = await settledDashboard();

        act(() => result.current.nextPage());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.currentPage).toBe(2);

        act(() => result.current.prevPage());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.currentPage).toBe(1);

        act(() => result.current.prevPage());
        expect(result.current.currentPage).toBe(1);
    });

    it('still reads the list and its count once each on refresh', async () => {
        const { result } = await settledDashboard();
        fx.reads = [];

        act(() => result.current.refreshData());

        await waitFor(() => expect(result.current.loading).toBe(false));
        await waitFor(() => expect(fx.reads.filter((read) => read.kind === 'count')).toHaveLength(2));
        // One count pass: the list's own count and the count of the records
        // it cannot show (no createdAt). One read of the list itself.
        expect(fx.reads.filter((read) => read.kind === 'docs')).toEqual([
            { kind: 'docs', path: 'companies/co-1/applications' },
        ]);
        expect(fx.reads.every((read) => read.path === 'companies/co-1/applications')).toBe(true);
    });
});
