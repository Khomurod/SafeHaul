import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

/**
 * The tab and segment a candidate list opens on: the page passes its own tab,
 * and a link can name a segment, as the dashboard's Hired card names `hired`.
 * The first list query is already the one the recruiter asked for, and another
 * tab still opens on its whole list.
 */
const fs = vi.hoisted(() => ({ queries: [] }));

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
            return { data: () => ({ count: 0 }) };
        },
    };
});
vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'recruiter-1' } } }));
vi.mock('@/context/DataContext', () => ({ useData: () => ({ currentCompanyProfile: { id: 'co-1', teamMembers: [] }, currentUserClaims: null }) }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));
vi.mock('@lib/runtime/dashboardRollup', () => ({ shouldPreferDashboardRollup: () => false }));

import { useCompanyDashboard } from './useCompanyDashboard';

/** The list queries (the stats only count), by collection. */
const listQueries = (collectionName) => fs.queries
    .filter((q) => q.kind === 'docs' && q.path === `companies/co-1/${collectionName}`);
const statusesOf = (q) => q.constraints.find((c) => c.kind === 'where' && c.args[0] === 'status')?.args[2];

afterEach(() => {
    fs.queries = [];
});

describe('the list a candidate page opens on', () => {
    it('asks first for the segment a link named', async () => {
        const { result } = renderHook(() => useCompanyDashboard('co-1', { initialSegment: 'hired' }));

        await waitFor(() => expect(listQueries('applications').length).toBeGreaterThan(0));
        expect(result.current.pipelineSegment).toBe('hired');
        expect(listQueries('applications').map(statusesOf)).toEqual(
            listQueries('applications').map(() => ['Hired', 'Approved']),
        );
    });

    it("asks first for the page's own tab", async () => {
        const { result } = renderHook(() => useCompanyDashboard('co-1', { initialTab: 'company_leads' }));

        await waitFor(() => expect(listQueries('leads').length).toBeGreaterThan(0));
        expect(result.current.activeTab).toBe('company_leads');
        expect(listQueries('applications')).toEqual([]);
    });

    it('opens another tab on its whole list', async () => {
        const { result } = renderHook(() => useCompanyDashboard('co-1', { initialSegment: 'hired' }));
        await waitFor(() => expect(listQueries('applications').length).toBeGreaterThan(0));

        fs.queries = [];
        act(() => result.current.setActiveTab('company_leads'));

        expect(result.current.pipelineSegment).toBe('all');
        await waitFor(() => expect(listQueries('leads').length).toBeGreaterThan(0));
        expect(listQueries('leads').map(statusesOf)).toEqual(listQueries('leads').map(() => undefined));
    });

    it('opens on the whole list of All Applications when nothing is named', async () => {
        const { result } = renderHook(() => useCompanyDashboard('co-1'));

        await waitFor(() => expect(listQueries('applications').length).toBeGreaterThan(0));
        expect(result.current.activeTab).toBe('applications');
        expect(result.current.pipelineSegment).toBe('all');
        expect(listQueries('applications').map(statusesOf)).toEqual(listQueries('applications').map(() => undefined));
    });
});
