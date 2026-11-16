import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

/**
 * The applications list opened on a month by the dashboard's brief. A month of
 * applications added is the list's own query with the month as cursors, counted
 * the same way. A month of hires is one list: the period's hires, newest hire
 * first and at most 200, then the segment and the filters on the client, and
 * counted as listed — the brief's number for it is a server count of the same
 * hire dates.
 *
 * Every record below is artificial.
 */
const fs = vi.hoisted(() => ({ queries: [], hires: [] }));

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
            const asksHires = q.constraints.some((c) => c.kind === 'where' && c.args[0] === 'hiredAt');
            const docs = asksHires ? fs.hires : [];
            return { docs: docs.map((data, i) => ({ id: data.id || `hire-${i}`, data: () => data })) };
        },
        getCountFromServer: async (q) => {
            fs.queries.push({ kind: 'count', ...q });
            return { data: () => ({ count: 7 }) };
        },
    };
});
vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'recruiter-1' } } }));
vi.mock('@/context/DataContext', () => ({ useData: () => ({ currentCompanyProfile: { id: 'co-1', teamMembers: [] }, currentUserClaims: null }) }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));
vi.mock('@lib/runtime/dashboardRollup', () => ({ shouldPreferDashboardRollup: () => false }));

import { useCompanyDashboard } from './useCompanyDashboard';
import { buildDashboardConstraints } from './dashboardQueries';
import { periodRange } from './dashboardPeriods';

const ADDED = { field: 'createdAt', month: '2026-11' };
const HIRED = { field: 'hiredAt', month: '2026-11' };
const ts = (date) => ({ toDate: () => date });
const of = (kind) => fs.queries.filter((q) => q.kind === kind && q.path === 'companies/co-1/applications');

afterEach(() => {
    fs.queries = [];
    fs.hires = [];
});

describe('a list opened on a month of applications added', () => {
    it('asks the server for that month, pages it and counts the same query', async () => {
        const { result } = renderHook(() => useCompanyDashboard('co-1', { initialPeriod: ADDED }));

        await waitFor(() => expect(result.current.totalCount).toBe(7));
        const expected = buildDashboardConstraints({ activeTab: 'applications', pipelineSegment: 'all', filters: { period: ADDED } });
        expect(of('count').map((q) => q.constraints)).toEqual([expected]);
        expect(of('docs').at(-1).constraints).toEqual([...expected, { kind: 'limit', args: [20] }]);
        // No record without a date can be in a month: nothing to count outside the list.
        expect(result.current.undatedCount).toBe(0);
        expect(result.current.filters.period).toEqual(ADDED);
    });

    it('lists every application again once the period is cleared', async () => {
        const { result } = renderHook(() => useCompanyDashboard('co-1', { initialPeriod: ADDED }));
        await waitFor(() => expect(of('count').length).toBe(1));

        fs.queries = [];
        act(() => result.current.setFilters((prev) => ({ ...prev, period: null })));

        await waitFor(() => expect(of('docs').length).toBeGreaterThan(0));
        expect(of('docs').at(-1).constraints).toEqual([
            { kind: 'orderBy', args: ['createdAt', 'desc'] },
            { kind: 'limit', args: [20] },
        ]);
    });
});

describe('a list opened on a month of hires', () => {
    const range = periodRange(HIRED);

    it('lists the hires of the month, whatever their status now and dated or not, counted as listed', async () => {
        fs.hires = [
            { id: 'stayed', status: 'Hired', createdAt: ts(new Date(2026, 9, 1)), hiredAt: ts(new Date(2026, 10, 9)) },
            { id: 'left', status: 'Terminated', createdAt: ts(new Date(2026, 9, 5)), hiredAt: ts(new Date(2026, 10, 7)) },
            { id: 'undated', status: 'Approved', hiredAt: ts(new Date(2026, 10, 8)) },
        ];
        const { result } = renderHook(() => useCompanyDashboard('co-1', { initialPeriod: HIRED }));

        await waitFor(() => expect(result.current.paginatedData.map((r) => r.id)).toEqual(['left', 'stayed', 'undated']));
        expect(result.current.totalCount).toBe(3);
        expect(result.current.totalPages).toBe(1);
        expect(result.current.listTruncated).toBe(false);
        expect(of('count')).toEqual([]);
        expect(of('docs').at(-1).constraints).toEqual([
            { kind: 'where', args: ['hiredAt', '>=', range.start] },
            { kind: 'where', args: ['hiredAt', '<', range.end] },
            { kind: 'orderBy', args: ['hiredAt', 'desc'] },
            { kind: 'limit', args: [201] },
        ]);
    });

    it('keeps the segment on the client: Hired leaves out those who left', async () => {
        fs.hires = [
            { id: 'stayed', status: 'Hired', hiredAt: ts(new Date(2026, 10, 9)) },
            { id: 'left', status: 'Terminated', hiredAt: ts(new Date(2026, 10, 7)) },
        ];
        const { result } = renderHook(() => useCompanyDashboard('co-1', { initialPeriod: HIRED, initialSegment: 'hired' }));

        await waitFor(() => expect(result.current.paginatedData.map((r) => r.id)).toEqual(['stayed']));
        expect(result.current.totalCount).toBe(1);
    });

    it('says when the month held more hires than it lists', async () => {
        fs.hires = Array.from({ length: 201 }, (_, i) => ({ id: `hire-${i}`, status: 'Hired', hiredAt: ts(new Date(2026, 10, 10)) }));
        const { result } = renderHook(() => useCompanyDashboard('co-1', { initialPeriod: HIRED }));

        await waitFor(() => expect(result.current.totalCount).toBe(200));
        expect(result.current.listTruncated).toBe(true);
    });
});

// The list page stays mounted across the menu's lists, so a period belongs to
// the navigation that opened it (`navigationKey`): the next one opens on its
// own period or none, and only applications have one.
describe('a period and the navigation that opened it', () => {
    it('drops the period when the menu opens another list, so leads never show a month of hires', async () => {
        fs.hires = [{ id: 'hire-1', status: 'Hired', hiredAt: ts(new Date(2026, 10, 9)) }];
        const { result, rerender } = renderHook(
            (props) => useCompanyDashboard('co-1', props),
            { initialProps: { initialTab: 'applications', initialPeriod: HIRED, navigationKey: 'from-brief' } },
        );
        await waitFor(() => expect(result.current.paginatedData.map((r) => r.id)).toEqual(['hire-1']));

        fs.queries = [];
        rerender({ initialTab: 'company_leads', initialPeriod: null, navigationKey: 'from-menu' });

        // The tab and the period change in the same render, before any query goes out.
        expect(result.current.activeTab).toBe('company_leads');
        expect(result.current.filters.period).toBeNull();
        await waitFor(() => expect(fs.queries.some((q) => q.path === 'companies/co-1/leads')).toBe(true));
        expect(fs.queries.some((q) => q.constraints.some((c) => c.kind === 'where' && c.args[0] === 'hiredAt'))).toBe(false);
    });

    it('opens on the period a later navigation brings, and keeps it while the same one lasts', async () => {
        const { result, rerender } = renderHook(
            (props) => useCompanyDashboard('co-1', props),
            { initialProps: { initialPeriod: null, navigationKey: 'first' } },
        );
        await waitFor(() => expect(of('docs').length).toBeGreaterThan(0));
        expect(result.current.filters.period).toBeNull();

        rerender({ initialPeriod: ADDED, navigationKey: 'second' });
        await waitFor(() => expect(result.current.filters.period).toEqual(ADDED));

        // A filter changed in the same navigation leaves the period alone.
        act(() => result.current.setFilters('state', 'TX'));
        rerender({ initialPeriod: ADDED, navigationKey: 'second' });
        expect(result.current.filters.period).toEqual(ADDED);
    });

    it('brings the tab and the month back together on Back, so no query mixes the two', async () => {
        fs.hires = [{ id: 'hire-1', status: 'Hired', hiredAt: ts(new Date(2026, 10, 9)) }];
        const { result, rerender } = renderHook(
            (props) => useCompanyDashboard('co-1', props),
            { initialProps: { initialTab: 'applications', initialPeriod: HIRED, navigationKey: 'from-brief' } },
        );
        await waitFor(() => expect(result.current.paginatedData.map((r) => r.id)).toEqual(['hire-1']));
        rerender({ initialTab: 'company_leads', initialPeriod: null, navigationKey: 'from-menu' });
        await waitFor(() => expect(fs.queries.some((q) => q.path === 'companies/co-1/leads')).toBe(true));

        fs.queries = [];
        rerender({ initialTab: 'applications', initialPeriod: HIRED, navigationKey: 'from-brief' });

        expect(result.current.activeTab).toBe('applications');
        expect(result.current.filters.period).toEqual(HIRED);
        await waitFor(() => expect(result.current.paginatedData.map((r) => r.id)).toEqual(['hire-1']));
        expect(fs.queries.some((q) => q.path === 'companies/co-1/leads')).toBe(false);
    });
});
