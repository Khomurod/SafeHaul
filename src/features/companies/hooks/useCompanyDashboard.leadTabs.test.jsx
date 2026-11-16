/**
 * The leads lists' tabs through the hook: Unassigned is a leads list in every
 * way — it reads the leads, pages them, counts them, segments them and searches
 * them — narrowed to `assignedTo == ''`. Assigned to me and Unassigned name
 * their assignee, so an Assigned to pick or Only mine carried over from another
 * list is not applied there (on Assigned to me it used to empty the list).
 *
 * Every record and id below is artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const fs = vi.hoisted(() => ({ queries: [], docs: [], searchDocs: [], count: 25 }));

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
        getDoc: async () => ({ exists: () => false }),
        getDocs: async (q) => {
            fs.queries.push({ kind: 'docs', ...q });
            const isSearch = q.constraints.some((c) => c.kind === 'where' && c.args[1] === '>=');
            const docs = isSearch ? fs.searchDocs : fs.docs;
            return { docs: docs.map((data) => ({ id: data.id, data: () => data })) };
        },
        getCountFromServer: async (q) => {
            fs.queries.push({ kind: 'count', ...q });
            return { data: () => ({ count: fs.count }) };
        },
    };
});
vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'recruiter-1' } } }));
vi.mock('@/context/DataContext', () => ({ useData: () => ({ currentCompanyProfile: { id: 'co-1', teamMembers: [] }, currentUserClaims: null }) }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));
vi.mock('@lib/runtime/dashboardRollup', () => ({ shouldPreferDashboardRollup: () => false }));

import { useCompanyDashboard } from './useCompanyDashboard';

const at = (iso) => ({ toDate: () => new Date(iso) });

afterEach(() => {
    fs.queries = [];
    fs.docs = [];
    fs.searchDocs = [];
    fs.count = 25;
});

const reads = (kind) => fs.queries.filter((q) => q.kind === kind);
const assigneesAsked = (q) => q.constraints
    .filter((c) => c.kind === 'where' && c.args[0] === 'assignedTo')
    .map((c) => c.args.slice(1));
const statusesAsked = (q) => q.constraints
    .filter((c) => c.kind === 'where' && c.args[0] === 'status')
    .map((c) => c.args.slice(1));

/** Longer than the list's 400 ms pause in typing. */
const pastTheDebounce = () => act(() => new Promise((resolve) => { setTimeout(resolve, 450); }));

async function openTab(initialTab) {
    const hook = renderHook((props) => useCompanyDashboard('co-1', props), { initialProps: { initialTab } });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await waitFor(() => expect(hook.result.current.totalCount).toBe(fs.count));
    return hook;
}

describe('the Unassigned tab', () => {
    it('lists and counts the leads whose assignedTo is empty, newest first', async () => {
        fs.docs = [{ id: 'lead-1', assignedTo: '', createdAt: at('2026-10-02T15:00:00Z') }];
        const { result } = await openTab('unassigned_leads');

        const list = reads('docs').at(-1);
        expect(list.path).toBe('companies/co-1/leads');
        expect(list.constraints).toEqual([
            { kind: 'where', args: ['assignedTo', '==', ''] },
            { kind: 'orderBy', args: ['createdAt', 'desc'] },
            { kind: 'limit', args: [20] },
        ]);
        // The list's count and the count of its records without createdAt ask the same filter.
        expect(reads('count').map((q) => [q.path, assigneesAsked(q)])).toEqual([
            ['companies/co-1/leads', [['==', '']]],
            ['companies/co-1/leads', [['==', '']]],
        ]);
        expect(result.current.paginatedData.map((r) => r.id)).toEqual(['lead-1']);
        expect(result.current.totalPages).toBe(2);
    });

    it('pages on with the same filter', async () => {
        fs.docs = [{ id: 'lead-1', assignedTo: '', createdAt: at('2026-10-02T15:00:00Z') }];
        const { result } = await openTab('unassigned_leads');
        fs.queries = [];

        act(() => result.current.nextPage());

        await waitFor(() => expect(reads('docs')).toHaveLength(1));
        const constraints = reads('docs')[0].constraints;
        expect(assigneesAsked(reads('docs')[0])).toEqual([['==', '']]);
        expect(constraints.find((c) => c.kind === 'startAfter').args[0].id).toBe('lead-1');
        expect(result.current.currentPage).toBe(2);
    });

    it("narrows by a lead segment: New is every value the dossier calls New", async () => {
        const { result } = await openTab('unassigned_leads');
        fs.queries = [];

        act(() => result.current.setPipelineSegment('new'));

        await waitFor(() => expect(reads('docs')).toHaveLength(1));
        expect(statusesAsked(reads('docs')[0])).toEqual([['in', ['New', 'New Application', 'New Lead']]]);
        expect(assigneesAsked(reads('docs')[0])).toEqual([['==', '']]);
        await waitFor(() => expect(reads('count').length).toBeGreaterThan(0));
        expect(reads('count').every((q) => statusesAsked(q).length === 1 && assigneesAsked(q).length === 1)).toBe(true);
    });

    it('searches the leads and keeps only those with no one assigned', async () => {
        fs.searchDocs = [
            { id: 'free', firstName: 'Mara', assignedTo: '', createdAt: at('2026-10-02T15:00:00Z') },
            { id: 'old-import', firstName: 'Mark', assignedTo: null, createdAt: at('2026-10-01T15:00:00Z') },
            { id: 'taken', firstName: 'Mary', assignedTo: 'recruiter-2', createdAt: at('2026-10-03T15:00:00Z') },
        ];
        const { result } = await openTab('unassigned_leads');

        act(() => result.current.setSearchQuery('ma'));
        await pastTheDebounce();

        await waitFor(() => expect(result.current.paginatedData.map((r) => r.id)).toEqual(['free', 'old-import']));
        expect(reads('docs').at(-1).path).toBe('companies/co-1/leads');
        expect(result.current.totalCount).toBe(2);
    });

    it('applies no Assigned to pick or Only mine carried over from another list', async () => {
        const { result } = await openTab('unassigned_leads');
        fs.queries = [];

        act(() => result.current.setFilters((prev) => ({ ...prev, assignee: 'recruiter-2', myAssignmentsOnly: true })));

        await waitFor(() => expect(reads('docs')).toHaveLength(1));
        expect(assigneesAsked(reads('docs')[0])).toEqual([['==', '']]);
    });

    it('opens on its whole list when the menu moves to it from another tab', async () => {
        const hook = await openTab('company_leads');
        act(() => hook.result.current.setPipelineSegment('attempting'));
        await waitFor(() => expect(hook.result.current.pipelineSegment).toBe('attempting'));
        fs.queries = [];

        hook.rerender({ initialTab: 'unassigned_leads' });
        act(() => hook.result.current.setActiveTab('unassigned_leads'));

        await waitFor(() => expect(hook.result.current.activeTab).toBe('unassigned_leads'));
        expect(hook.result.current.pipelineSegment).toBe('all');
        await waitFor(() => expect(reads('docs').length).toBeGreaterThan(0));
        expect(reads('docs').every((q) => statusesAsked(q).length === 0)).toBe(true);
        expect(assigneesAsked(reads('docs').at(-1))).toEqual([['==', '']]);
    });
});

describe('the Assigned to me tab', () => {
    it('keeps to the signed-in recruiter when an Assigned to pick is carried over, rather than emptying', async () => {
        const { result } = await openTab('my_leads');
        fs.queries = [];

        act(() => result.current.setFilters((prev) => ({ ...prev, assignee: 'recruiter-2' })));

        await waitFor(() => expect(reads('docs')).toHaveLength(1));
        expect(assigneesAsked(reads('docs')[0])).toEqual([['==', 'recruiter-1']]);
    });
});

describe('the All leads tab', () => {
    it('applies the Assigned to pick, and no Only mine, which only Applications offers', async () => {
        const { result } = await openTab('company_leads');
        fs.queries = [];

        act(() => result.current.setFilters((prev) => ({ ...prev, assignee: '__unassigned__', myAssignmentsOnly: true })));

        await waitFor(() => expect(reads('docs')).toHaveLength(1));
        expect(assigneesAsked(reads('docs')[0])).toEqual([['==', '']]);
    });
});
