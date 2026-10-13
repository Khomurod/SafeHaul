/**
 * The team the candidate lists offer in their Assigned to filter: the company's
 * team by name, each with the uid the filter matches `assignedTo` against. The
 * `companies/{id}/team` documents the hook used to read hold the recruiters'
 * call goals, not their names, and exist only for those who have goals.
 *
 * All names, emails and ids below are artificial.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({
    profile: {
        id: 'co-1',
        teamMembers: [
            { userId: 'uid-ann', name: 'Ann Admin', email: 'ann@example.com', role: 'company_admin' },
            { userId: 'uid-ben', name: 'Ben Recruiter', email: 'ben@example.com', role: 'recruiter' },
        ],
    },
}));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: fx.profile, currentUserClaims: { roles: { 'co-1': 'company_admin' } } }),
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
        getDocs: async (q) => (q.path === 'companies/co-1/team'
            // A goals document, as Manage Team writes it.
            ? { docs: [{ id: 'uid-ben', data: () => ({ callGoal: 40, contactGoal: 10 }) }] }
            : { docs: [] }),
        getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
    };
});
vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'uid-ann' } } }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));
vi.mock('@lib/runtime/dashboardRollup', () => ({ shouldPreferDashboardRollup: () => false }));

import { useCompanyDashboard } from './useCompanyDashboard';

describe("useCompanyDashboard's team", () => {
    it("offers the company's whole team by name, each with the uid the filter matches", async () => {
        const { result } = renderHook(() => useCompanyDashboard('co-1'));

        await waitFor(() => expect(result.current.teamMembers).toHaveLength(2));
        expect(result.current.teamMembers.map(({ id, name }) => ({ id, name }))).toEqual([
            { id: 'uid-ann', name: 'Ann Admin' },
            { id: 'uid-ben', name: 'Ben Recruiter' },
        ]);
    });
});
