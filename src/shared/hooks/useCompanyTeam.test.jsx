/**
 * The company's team as the pickers and filters list it. The company document
 * carries the team (`teamMembers`, which `functions/hrAdmin/membership.js`
 * rewrites on every membership change) and the whole team may read it; the
 * `memberships` it is built from are refused to a recruiter by the rules. Each
 * member comes with the uid as `id`, the value `assignedTo` stores.
 *
 * All names, emails and ids below are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({
    data: {},
    getDocs: vi.fn(),
    getDoc: vi.fn(),
}));

vi.mock('@/context/DataContext', () => ({ useData: () => fx.data }));
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    doc: (_db, ...path) => ({ path: path.join('/') }),
    query: (base, ...constraints) => ({ path: base.path, constraints }),
    where: (field, op, value) => ({ field, op, value }),
    getDocs: (...args) => fx.getDocs(...args),
    getDoc: (...args) => fx.getDoc(...args),
    onSnapshot: (q, next) => {
        // The membership listener the hook used to open: answered as a refusal.
        fx.getDocs(q);
        next({ docs: [] });
        return () => {};
    },
}));

import { useCompanyTeam } from './useCompanyTeam';

const CACHE = [
    { userId: 'uid-ann', name: 'Ann Admin', email: 'ann@example.com', role: 'company_admin' },
    { userId: 'uid-ben', name: 'Unknown', email: 'ben@example.com', role: 'recruiter' },
];

const recruiter = { roles: { 'co-1': 'recruiter' } };
const admin = { roles: { 'co-1': 'company_admin' } };

afterEach(() => {
    fx.data = {};
    fx.getDocs.mockReset();
    fx.getDoc.mockReset();
});

describe('useCompanyTeam', () => {
    it("lists the company's team from its document, with each member's uid as the id", async () => {
        fx.data = { currentCompanyProfile: { id: 'co-1', teamMembers: CACHE }, currentUserClaims: recruiter };
        const { result } = renderHook(() => useCompanyTeam('co-1'));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.team).toEqual([
            { id: 'uid-ann', name: 'Ann Admin', email: 'ann@example.com', role: 'company_admin' },
            // A profile the server could not name shows its email.
            { id: 'uid-ben', name: 'ben@example.com', email: 'ben@example.com', role: 'recruiter' },
        ]);
        expect(fx.getDocs).not.toHaveBeenCalled();
    });

    it("asks a recruiter's browser for no memberships, which the rules refuse it", async () => {
        fx.data = { currentCompanyProfile: { id: 'co-1' }, currentUserClaims: recruiter };
        fx.getDocs.mockRejectedValue(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
        const { result } = renderHook(() => useCompanyTeam('co-1'));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.team).toEqual([]);
        expect(fx.getDocs).not.toHaveBeenCalled();
    });

    it("builds an admin's team from the memberships, once, when the company document has none", async () => {
        fx.data = { currentCompanyProfile: { id: 'co-1' }, currentUserClaims: admin };
        fx.getDocs.mockResolvedValue({
            docs: [{ data: () => ({ userId: 'uid-ann', role: 'company_admin' }) }],
        });
        fx.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ fullName: 'Ann Admin', email: 'ann@example.com' }) });
        const { result } = renderHook(() => useCompanyTeam('co-1'));

        await waitFor(() => expect(result.current.team).toHaveLength(1));
        expect(result.current.team[0]).toEqual({ id: 'uid-ann', name: 'Ann Admin', email: 'ann@example.com', role: 'company_admin' });
        expect(fx.getDocs).toHaveBeenCalledTimes(1);
        expect(fx.getDocs.mock.calls[0][0]).toMatchObject({ path: 'memberships' });
    });

    it("does not take another company's team for this one", async () => {
        fx.data = { currentCompanyProfile: { id: 'co-2', teamMembers: CACHE }, currentUserClaims: recruiter };
        const { result } = renderHook(() => useCompanyTeam('co-1'));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.team).toEqual([]);
    });
});
