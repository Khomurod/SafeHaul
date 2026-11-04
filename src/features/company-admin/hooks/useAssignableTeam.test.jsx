/**
 * The team Assign Leads and Import Leads offer: the company's saved team list
 * (`companies/{id}.teamMembers`), read fresh once when the screen opens, so
 * someone who joined after the company was entered is offered. With the list in
 * the document that is the only read; without one, an admin's team comes from
 * the memberships (`useCompanyTeam`).
 *
 * All names, emails and ids below are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({
    data: {},
    getCompanyProfile: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
}));

vi.mock('@/context/DataContext', () => ({ useData: () => fx.data }));
vi.mock('@features/companies/services/companyService', () => ({
    getCompanyProfile: (...args) => fx.getCompanyProfile(...args),
}));
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    doc: (_db, ...path) => ({ path: path.join('/') }),
    query: (base, ...constraints) => ({ path: base.path, constraints }),
    where: (field, op, value) => ({ field, op, value }),
    getDocs: (...args) => fx.getDocs(...args),
    getDoc: (...args) => fx.getDoc(...args),
}));

import { useAssignableTeam } from './useAssignableTeam';

const CARA = { userId: 'uid-cara', name: 'Cara Diaz', email: 'cara@example.test', role: 'recruiter' };
const ANN = { userId: 'uid-ann', name: 'Ann Baker', email: 'ann@example.test', role: 'company_admin' };
const BEN = { userId: 'uid-ben', name: 'Unknown', email: 'ben@example.test', role: 'recruiter' };

const admin = { roles: { 'co-1': 'company_admin' } };

/** A promise the test settles itself. */
function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

function answerMemberships() {
    fx.getDocs.mockImplementation(async () => ({
        docs: [{ data: () => ({ userId: 'uid-ann', role: 'company_admin' }) }, { data: () => ({ userId: 'uid-ben', role: 'recruiter' }) }],
    }));
    fx.getDoc.mockImplementation(async (ref) => {
        const id = ref.path.split('/').pop();
        return { exists: () => true, data: () => (id === 'uid-ann' ? { fullName: 'Ann Baker', email: 'ann@example.test' } : { email: 'ben@example.test' }) };
    });
}

afterEach(() => {
    vi.resetAllMocks();
    fx.data = {};
});

describe('useAssignableTeam', () => {
    it("lists the fresh document's team in its order from that one read, with no memberships or profile reads", async () => {
        fx.data = { currentCompanyProfile: { id: 'co-1', teamMembers: [ANN] }, currentUserClaims: admin };
        fx.getCompanyProfile.mockImplementation(async () => ({ id: 'co-1', teamMembers: [CARA, ANN, BEN] }));
        const { result } = renderHook(() => useAssignableTeam('co-1'));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.team).toEqual([
            { id: 'uid-cara', name: 'Cara Diaz', email: 'cara@example.test', role: 'recruiter' },
            { id: 'uid-ann', name: 'Ann Baker', email: 'ann@example.test', role: 'company_admin' },
            { id: 'uid-ben', name: 'ben@example.test', email: 'ben@example.test', role: 'recruiter' },
        ]);
        expect(fx.getCompanyProfile).toHaveBeenCalledTimes(1);
        expect(fx.getCompanyProfile).toHaveBeenCalledWith('co-1');
        expect(fx.getDocs).not.toHaveBeenCalled();
        expect(fx.getDoc).not.toHaveBeenCalled();
    });

    it('is loading, with no team and no memberships query, until the read settles', async () => {
        // The copy from entering the company has no list, so only the wait for
        // the fresh read keeps the memberships from being listed for nothing.
        fx.data = { currentCompanyProfile: { id: 'co-1' }, currentUserClaims: admin };
        const read = deferred();
        fx.getCompanyProfile.mockImplementation(() => read.promise);
        const { result } = renderHook(() => useAssignableTeam('co-1'));

        expect(result.current).toEqual({ team: [], isLoading: true });
        await waitFor(() => expect(fx.getCompanyProfile).toHaveBeenCalledTimes(1));
        expect(result.current.isLoading).toBe(true);

        read.resolve({ id: 'co-1', teamMembers: [CARA] });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.team.map((m) => m.id)).toEqual(['uid-cara']);
        expect(fx.getDocs).not.toHaveBeenCalled();
    });

    it('uses the copy read on entering the company when the fresh read gives nothing', async () => {
        fx.data = { currentCompanyProfile: { id: 'co-1', teamMembers: [ANN, BEN] }, currentUserClaims: admin };
        fx.getCompanyProfile.mockImplementation(async () => null);
        const { result } = renderHook(() => useAssignableTeam('co-1'));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.team.map((m) => [m.id, m.name])).toEqual([
            ['uid-ann', 'Ann Baker'],
            ['uid-ben', 'ben@example.test'],
        ]);
        expect(fx.getDocs).not.toHaveBeenCalled();
    });

    it('gives an empty team, not loading, and reads nothing without a company', () => {
        fx.data = { currentCompanyProfile: { id: 'co-1', teamMembers: [ANN] }, currentUserClaims: admin };
        const { result } = renderHook(() => useAssignableTeam(undefined));

        expect(result.current).toEqual({ team: [], isLoading: false });
        expect(fx.getCompanyProfile).not.toHaveBeenCalled();
    });

    it.each([
        ['a fresh document without a team list', { id: 'co-1', companyName: 'Artificial Freight' }, { id: 'co-1', teamMembers: [ANN] }],
        ['no fresh read and no list in the copy from entering', null, { id: 'co-1' }],
    ])("lists an admin's memberships, then their profiles, after %s", async (_case, fresh, entered) => {
        fx.data = { currentCompanyProfile: entered, currentUserClaims: admin };
        fx.getCompanyProfile.mockImplementation(async () => fresh);
        answerMemberships();
        const { result } = renderHook(() => useAssignableTeam('co-1'));

        await waitFor(() => expect(result.current.team).toHaveLength(2));
        expect(result.current.isLoading).toBe(false);
        expect(result.current.team.map((m) => [m.id, m.name])).toEqual([
            ['uid-ann', 'Ann Baker'],
            ['uid-ben', 'ben@example.test'],
        ]);
        expect(fx.getDocs).toHaveBeenCalledTimes(1);
        expect(fx.getDocs.mock.calls[0][0]).toMatchObject({ path: 'memberships' });
        expect(fx.getDoc.mock.calls.map(([ref]) => ref.path)).toEqual(['users/uid-ann', 'users/uid-ben']);
    });

    it("does not offer one company's team for another while that one's read is out", async () => {
        fx.data = { currentCompanyProfile: { id: 'co-1', teamMembers: [ANN] }, currentUserClaims: { roles: { 'co-1': 'company_admin', 'co-2': 'company_admin' } } };
        const second = deferred();
        fx.getCompanyProfile.mockImplementation((companyId) => (companyId === 'co-1'
            ? Promise.resolve({ id: 'co-1', teamMembers: [ANN] })
            : second.promise));
        const { result, rerender } = renderHook(({ companyId }) => useAssignableTeam(companyId), { initialProps: { companyId: 'co-1' } });
        await waitFor(() => expect(result.current.team.map((m) => m.id)).toEqual(['uid-ann']));

        rerender({ companyId: 'co-2' });
        expect(result.current).toEqual({ team: [], isLoading: true });

        second.resolve({ id: 'co-2', teamMembers: [CARA] });
        await waitFor(() => expect(result.current.team.map((m) => m.id)).toEqual(['uid-cara']));
        expect(result.current.isLoading).toBe(false);
        expect(fx.getDocs).not.toHaveBeenCalled();
    });
});
