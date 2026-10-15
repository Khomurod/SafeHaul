/**
 * The company dashboard's four counts, and nothing else: the rollup document
 * when the runtime prefers it and it is complete, else four count queries. The
 * dashboard shows no list, so it reads no records.
 *
 * All ids below are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({
    reads: [],
    rollup: null,
    preferRollup: false,
    e2e: false,
    user: { uid: 'uid-1' },
    countsFail: false,
    gate: null,
}));

vi.mock('firebase/firestore', () => {
    const record = (kind) => (...args) => ({ kind, args });
    return {
        collection: (_db, ...path) => ({ path: path.join('/') }),
        doc: (_db, ...path) => ({ path: path.join('/') }),
        query: (base, ...constraints) => ({ path: base.path, constraints }),
        where: record('where'),
        orderBy: record('orderBy'),
        limit: record('limit'),
        startAt: record('startAt'),
        startAfter: record('startAfter'),
        endAt: record('endAt'),
        endBefore: record('endBefore'),
        documentId: () => '__name__',
        getDoc: async (ref) => {
            fx.reads.push({ kind: 'doc', path: ref.path });
            return { exists: () => Boolean(fx.rollup), data: () => fx.rollup };
        },
        getDocs: async (q) => {
            fx.reads.push({ kind: 'docs', path: q.path });
            return { docs: [] };
        },
        getCountFromServer: async (q) => {
            fx.reads.push({ kind: 'count', path: q.path, constraints: (q.constraints || []).map((c) => c.args) });
            if (fx.gate && q.path.startsWith(fx.gate.companyPath)) await fx.gate.promise;
            if (fx.countsFail) throw new Error('Quota exceeded.');
            return { data: () => ({ count: q.path.startsWith('companies/co-2') ? 2 : 7 }) };
        },
    };
});
vi.mock('@lib/firebase', () => ({ db: {}, auth: { get currentUser() { return fx.user; } } }));
vi.mock('@lib/runtime/e2eMode', () => ({ get isE2ETestMode() { return fx.e2e; } }));
vi.mock('@lib/runtime/dashboardRollup', () => ({ shouldPreferDashboardRollup: () => fx.preferRollup }));

import { useDashboardCounts } from './useDashboardCounts';

afterEach(() => {
    Object.assign(fx, { reads: [], rollup: null, preferRollup: false, e2e: false, user: { uid: 'uid-1' }, countsFail: false, gate: null });
});

const STATS_COUNTS = [
    { kind: 'count', path: 'companies/co-1/applications', constraints: [] },
    { kind: 'count', path: 'companies/co-1/leads', constraints: [] },
    { kind: 'count', path: 'companies/co-1/leads', constraints: [['assignedTo', '==', 'uid-1']] },
    { kind: 'count', path: 'companies/co-1/applications', constraints: [['status', 'in', ['Hired', 'Approved']]] },
];

describe('the dashboard counts', () => {
    it('come from four count queries, and no record is read', async () => {
        const { result } = renderHook(() => useDashboardCounts('co-1'));

        await waitFor(() => expect(result.current.counts).toEqual({ applications: 7, companyLeads: 7, myLeads: 7, hired: 7 }));
        expect(fx.reads).toEqual(expect.arrayContaining(STATS_COUNTS));
        expect(fx.reads).toHaveLength(STATS_COUNTS.length);
        expect(result.current.statsFetchError).toBe('');
    });

    it('come from the rollup when it is complete, with the recruiter’s own leads counted', async () => {
        fx.preferRollup = true;
        fx.rollup = { schemaVersion: 1, applicationsTotal: 12, leadsTotal: 30, hiredTotal: 4 };
        const { result } = renderHook(() => useDashboardCounts('co-1'));

        await waitFor(() => expect(result.current.counts).toEqual({ applications: 12, companyLeads: 30, myLeads: 7, hired: 4 }));
        expect(fx.reads).toEqual([
            { kind: 'count', path: 'companies/co-1/leads', constraints: [['assignedTo', '==', 'uid-1']] },
            { kind: 'doc', path: 'companies/co-1/internal_stats/dashboard' },
        ]);
    });

    it('say what failed, and read again on Retry', async () => {
        fx.countsFail = true;
        const { result } = renderHook(() => useDashboardCounts('co-1'));

        await waitFor(() => expect(result.current.statsFetchError).toBe('Quota exceeded.'));
        fx.countsFail = false;
        await act(() => result.current.refresh());

        expect(result.current.statsFetchError).toBe('');
        expect(result.current.counts.applications).toBe(7);
    });

    it('stay those of the company on screen when an earlier company answers late', async () => {
        let release;
        fx.gate = { companyPath: 'companies/co-1', promise: new Promise((resolve) => { release = resolve; }) };
        const { result, rerender } = renderHook(({ companyId }) => useDashboardCounts(companyId), { initialProps: { companyId: 'co-1' } });

        rerender({ companyId: 'co-2' });
        await waitFor(() => expect(result.current.counts.applications).toBe(2));
        await act(async () => { release(); });

        expect(result.current.counts).toEqual({ applications: 2, companyLeads: 2, myLeads: 2, hired: 2 });
    });

    it('come from the test records in a browser-test build, read from nowhere', async () => {
        fx.e2e = true;
        fx.user = null;
        const { result } = renderHook(() => useDashboardCounts('co-1'));

        await waitFor(() => expect(result.current.counts).toEqual({ applications: 8, companyLeads: 2, myLeads: 1, hired: 2 }));
        expect(fx.reads).toEqual([]);
    });

    it('wait for a company', () => {
        const { result } = renderHook(() => useDashboardCounts(undefined));

        expect(result.current.counts).toEqual({ applications: 0, companyLeads: 0, myLeads: 0, hired: 0 });
        expect(fx.reads).toEqual([]);
    });
});
