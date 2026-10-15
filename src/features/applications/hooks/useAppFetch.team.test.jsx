/**
 * The dossier's team, which its Assign To picker lists. Each member comes with
 * the uid as `id`, the value the picker saves as `assignedTo`: the company
 * document's team cache keys a member by `userId`, and a picker reading `id`
 * from it saved the recruiter's name instead. A recruiter's browser asks for no
 * `memberships`, which the rules refuse it.
 *
 * All names, emails and ids below are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({
    profile: null,
    freshProfile: null,
    claims: { roles: { 'co-1': 'recruiter' } },
    getDocs: vi.fn(),
}));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: fx.profile, currentUserClaims: fx.claims }),
}));
vi.mock('@lib/firebase', () => ({ db: {}, storage: {}, functions: {} }));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
// The company profile the dossier reads itself on opening.
vi.mock('@features/companies', () => ({ getCompanyProfile: async () => fx.freshProfile || fx.profile }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    doc: (_db, ...path) => ({ path: path.join('/') }),
    query: (base, ...constraints) => ({ path: base.path, constraints }),
    where: (field, op, value) => ({ field, op, value }),
    getDocs: (...args) => fx.getDocs(...args),
    getDoc: async (ref) => (ref.path === 'companies/co-1/applications/app-1'
        ? { exists: () => true, data: () => ({ status: 'New Application', assignedTo: '' }) }
        : { exists: () => false }),
    onSnapshot: (q, next) => {
        fx.getDocs(q);
        next({ docs: [] });
        return () => {};
    },
}));

import { useAppFetch } from './useAppFetch';

afterEach(() => {
    fx.freshProfile = null;
    fx.getDocs.mockReset();
});

describe("useAppFetch's team", () => {
    it("lists the company's team with each member's uid as the id the picker saves", async () => {
        fx.profile = {
            id: 'co-1',
            teamMembers: [{ userId: 'uid-ben', name: 'Ben Recruiter', email: 'ben@example.com', role: 'recruiter' }],
        };
        fx.getDocs.mockRejectedValue(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        await waitFor(() => expect(result.current.teamMembers).toHaveLength(1));
        expect(result.current.teamMembers[0]).toMatchObject({ id: 'uid-ben', name: 'Ben Recruiter' });
        expect(fx.getDocs.mock.calls.filter(([q]) => q?.path === 'memberships')).toHaveLength(0);
    });

    it('lists a member who joined after sign-in, from the profile the dossier reads on opening', async () => {
        const ben = { userId: 'uid-ben', name: 'Ben Recruiter', email: 'ben@example.com', role: 'recruiter' };
        fx.profile = { id: 'co-1', teamMembers: [ben] };
        fx.freshProfile = { id: 'co-1', teamMembers: [ben, { userId: 'uid-cara', name: 'Cara Recruiter', email: 'cara@example.com', role: 'recruiter' }] };
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));

        await waitFor(() => expect(result.current.teamMembers).toHaveLength(2));
        expect(result.current.teamMembers[1]).toMatchObject({ id: 'uid-cara', name: 'Cara Recruiter' });
    });
});
