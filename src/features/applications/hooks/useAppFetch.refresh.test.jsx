/**
 * `refreshRecord`: the dossier reads its record again after a change made from
 * it (a logged call), so the stage the call moved and the last call show. Quiet:
 * no loading state and no new signing of the record's files. A read that answers
 * after the dossier moved to another record changes nothing.
 *
 * All names and ids below are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({ stored: {}, reads: [], hold: null }));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'co-1', teamMembers: [] }, currentUserClaims: {} }),
}));
vi.mock('@lib/firebase', () => ({ db: {}, storage: {}, functions: {} }));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('@features/companies', () => ({ getCompanyProfile: async () => ({ id: 'co-1', teamMembers: [] }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    doc: (_db, ...path) => ({ path: path.join('/') }),
    query: (base, ...constraints) => ({ path: base.path, constraints }),
    where: (field, op, value) => ({ field, op, value }),
    getDocs: async () => ({ docs: [] }),
    getDoc: async (ref) => {
        fx.reads.push(ref.path);
        if (fx.hold && ref.path === fx.hold.path) await fx.hold.promise;
        const data = fx.stored[ref.path];
        return data ? { exists: () => true, data: () => data } : { exists: () => false };
    },
    onSnapshot: (_q, next) => {
        next({ docs: [] });
        return () => {};
    },
}));

import { useAppFetch } from './useAppFetch';

const APP = 'companies/co-1/applications/app-1';

afterEach(() => {
    fx.stored = {};
    fx.reads = [];
    fx.hold = null;
});

describe("useAppFetch's refreshRecord", () => {
    it('shows the stage and last call as stored now, without loading again', async () => {
        fx.stored[APP] = { firstName: 'Maria', status: 'Contact Attempt 1' };
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.currentStatus).toBe('Contact Attempt 1');

        fx.stored[APP] = { firstName: 'Maria', status: 'Interested', lastCallOutcome: 'Connected / Interested' };
        const loadingSeen = [];
        await act(async () => {
            const refreshing = result.current.refreshRecord();
            loadingSeen.push(result.current.loading);
            await refreshing;
        });

        expect(loadingSeen).toEqual([false]);
        expect(result.current.loading).toBe(false);
        expect(result.current.currentStatus).toBe('Interested');
        expect(result.current.appData).toMatchObject({ lastCallOutcome: 'Connected / Interested' });
        // The application read once on opening, once on refreshing; the leads never.
        expect(fx.reads.filter((path) => path === APP)).toHaveLength(2);
    });

    it('reads a lead from the leads', async () => {
        fx.stored['companies/co-1/leads/lead-1'] = { firstName: 'Dana', status: 'New Lead' };
        const { result } = renderHook(() => useAppFetch('co-1', 'lead-1'));
        await waitFor(() => expect(result.current.collectionName).toBe('leads'));

        fx.stored['companies/co-1/leads/lead-1'] = { firstName: 'Dana', status: 'Declined', archived: true };
        await act(() => result.current.refreshRecord());

        expect(result.current.currentStatus).toBe('Declined');
    });

    it('changes nothing when it answers after the dossier moved to another record', async () => {
        fx.stored[APP] = { firstName: 'Maria', status: 'New Application' };
        fx.stored['companies/co-1/applications/app-2'] = { firstName: 'Jane', status: 'Hired' };
        const { result, rerender } = renderHook(({ id }) => useAppFetch('co-1', id), { initialProps: { id: 'app-1' } });
        await waitFor(() => expect(result.current.loading).toBe(false));

        let release;
        fx.hold = { path: APP, promise: new Promise((resolve) => { release = resolve; }) };
        let refreshing;
        act(() => { refreshing = result.current.refreshRecord(); });

        fx.hold = null;
        rerender({ id: 'app-2' });
        await waitFor(() => expect(result.current.appData).toMatchObject({ firstName: 'Jane' }));

        fx.stored[APP] = { firstName: 'Maria', status: 'Interested' };
        await act(async () => {
            release();
            await refreshing;
        });

        expect(result.current.appData).toMatchObject({ firstName: 'Jane' });
        expect(result.current.currentStatus).toBe('Hired');
    });
});
