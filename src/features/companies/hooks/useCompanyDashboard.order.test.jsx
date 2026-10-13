import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

/**
 * The candidate list's order and the records it cannot show, through the hook.
 *
 * Firestore sorts every list by createdAt, and a sort leaves out a record
 * without it, so the hook counts the list twice: once as it is listed, once
 * by its filters alone. The difference is what the page tells the recruiter to
 * find by search. The Added Date arrows set the order Firestore sorts by.
 */
const fs = vi.hoisted(() => ({
    listedCount: 10,
    everyCount: 13,
    failEveryCount: false,
    // Leads count 2 either way; applications' counts can be held back.
    leadsCount: 2,
    applicationsGate: null,
    queries: [],
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
            fs.queries.push({ kind: 'docs', ...q });
            return { docs: [] };
        },
        getCountFromServer: async (q) => {
            fs.queries.push({ kind: 'count', ...q });
            const sorted = (q.constraints || []).some((c) => c.kind === 'orderBy');
            if (q.path.endsWith('/leads')) return { data: () => ({ count: fs.leadsCount }) };
            if (fs.applicationsGate) await fs.applicationsGate;
            if (!sorted && fs.failEveryCount) throw new Error('The query requires an index.');
            return { data: () => ({ count: sorted ? fs.listedCount : fs.everyCount }) };
        },
    };
});
vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'recruiter-1' } } }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));
vi.mock('@lib/runtime/dashboardRollup', () => ({ shouldPreferDashboardRollup: () => false }));

import { useCompanyDashboard } from './useCompanyDashboard';

const APPLICATIONS = 'companies/co-1/applications';
const sortOf = (q) => (q.constraints || []).find((c) => c.kind === 'orderBy')?.args;
const listQueries = (kind) => fs.queries.filter((q) => q.kind === kind && q.path === APPLICATIONS && q.constraints);

afterEach(() => {
    fs.queries = [];
    fs.failEveryCount = false;
    fs.applicationsGate = null;
    vi.restoreAllMocks();
});

describe('useCompanyDashboard order', () => {
    it('lists All Applications newest first and counts the records without createdAt', async () => {
        const { result } = renderHook(() => useCompanyDashboard('co-1'));

        await waitFor(() => expect(result.current.undatedCount).toBe(3));
        expect(result.current.totalCount).toBe(10);
        expect(listQueries('docs').every((q) => sortOf(q)?.join(' ') === 'createdAt desc')).toBe(true);
        expect(listQueries('docs').length).toBeGreaterThan(0);
    });

    it('asks Firestore for the earliest first when the arrow turns the order', async () => {
        const { result } = renderHook(() => useCompanyDashboard('co-1'));
        await waitFor(() => expect(listQueries('docs').length).toBeGreaterThan(0));

        act(() => result.current.setDateOrder('asc'));

        await waitFor(() => expect(listQueries('docs').some((q) => sortOf(q)?.join(' ') === 'createdAt asc')).toBe(true));
        expect(result.current.dateOrder).toBe('asc');
        expect(result.current.currentPage).toBe(1);
    });

    it('keeps the list and its count when the count of undated records fails', async () => {
        fs.failEveryCount = true;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useCompanyDashboard('co-1'));

        await waitFor(() => expect(result.current.totalCount).toBe(10));
        expect(result.current.undatedCount).toBe(0);
        expect(result.current.listCountError).toBe('');
        expect(listQueries('count').some((q) => !sortOf(q))).toBe(true);
    });

    it("keeps the counts of the list on screen when an earlier list's count answers last", async () => {
        // The page mounts the hook on All Applications and then switches it to
        // its own tab; here the applications' counts answer after the leads'.
        let release;
        fs.applicationsGate = new Promise((resolve) => { release = resolve; });
        const { result } = renderHook(() => useCompanyDashboard('co-1'));
        await waitFor(() => expect(listQueries('count').length).toBeGreaterThan(0));

        act(() => result.current.setActiveTab('company_leads'));
        await waitFor(() => expect(result.current.totalCount).toBe(2));

        await act(async () => {
            release();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(result.current.totalCount).toBe(2);
        expect(result.current.undatedCount).toBe(0);
    });

    it('counts nothing outside the list when a day is picked, which no undated record can match', async () => {
        const { result } = renderHook(() => useCompanyDashboard('co-1'));
        await waitFor(() => expect(result.current.undatedCount).toBe(3));

        fs.queries = [];
        act(() => result.current.setFilters((prev) => ({ ...prev, dateFilter: '2026-10-12' })));

        await waitFor(() => expect(result.current.undatedCount).toBe(0));
        expect(listQueries('count').every((q) => sortOf(q))).toBe(true);
    });
});
