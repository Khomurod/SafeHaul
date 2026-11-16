/**
 * The dossier finds its record where its opener says it is (`collectionHint`):
 * a list, a bell notice, the linked lead or application and Add lead know the
 * collection, so a lead is one read instead of a miss in the applications and
 * then the lead. A wrong hint still finds the record in the other collection, and
 * with no hint (or an unknown one) the applications are looked in first, as
 * before.
 *
 * All names and ids below are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({ stored: {}, reads: [] }));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'co-1', teamMembers: [] }, currentUserClaims: {} }),
}));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {}, auth: { currentUser: null } }));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('@features/companies', () => ({ getCompanyProfile: async () => ({ id: 'co-1', teamMembers: [] }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    doc: (_db, ...path) => ({ path: path.join('/') }),
    query: (base) => base,
    where: () => ({}),
    getDocs: async () => ({ docs: [] }),
    getDoc: async (ref) => {
        fx.reads.push(ref.path);
        const data = fx.stored[ref.path];
        return data ? { exists: () => true, data: () => data } : { exists: () => false };
    },
}));

import { useAppFetch } from './useAppFetch';

const APP = 'companies/co-1/applications/rec-1';
const LEAD = 'companies/co-1/leads/rec-1';

afterEach(() => {
    fx.stored = {};
    fx.reads = [];
});

async function open(hint) {
    const hook = renderHook(() => useAppFetch('co-1', 'rec-1', hint));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook.result;
}

describe('the dossier record, where its opener says it is', () => {
    it('reads a lead once when the opener names the leads', async () => {
        fx.stored[LEAD] = { firstName: 'Dana', status: 'New Lead' };
        const result = await open('leads');

        expect(result.current.collectionName).toBe('leads');
        expect(result.current.appData.firstName).toBe('Dana');
        expect(fx.reads).toEqual([LEAD]);
    });

    it('without a hint, still finds a lead after the applications: two reads, as before', async () => {
        fx.stored[LEAD] = { firstName: 'Dana', status: 'New Lead' };
        const result = await open(undefined);

        expect(result.current.collectionName).toBe('leads');
        expect(fx.reads).toEqual([APP, LEAD]);
    });

    it.each([['applications'], [undefined], ['drafts']])('reads an application once with the hint %s', async (hint) => {
        fx.stored[APP] = { firstName: 'Ann', status: 'New Application' };
        const result = await open(hint);

        expect(result.current.collectionName).toBe('applications');
        expect(result.current.appData.firstName).toBe('Ann');
        expect(fx.reads).toEqual([APP]);
    });

    it('finds the record in the other collection when the hint is wrong', async () => {
        fx.stored[APP] = { firstName: 'Ann', status: 'New Application' };
        const result = await open('leads');

        expect(result.current.collectionName).toBe('applications');
        expect(result.current.appData.firstName).toBe('Ann');
        expect(fx.reads).toEqual([LEAD, APP]);
    });

    it('says the record is missing after looking in both', async () => {
        const result = await open('leads');

        expect(result.current.error).toBe('Could not find record (ID: rec-1).');
        expect(fx.reads).toEqual([LEAD, APP]);
    });

    it('reads a lead opened by its hint again from the leads after a logged call', async () => {
        fx.stored[LEAD] = { firstName: 'Dana', status: 'New Lead' };
        const result = await open('leads');

        fx.stored[LEAD] = { firstName: 'Dana', status: 'Interested' };
        await act(() => result.current.refreshRecord());

        expect(result.current.currentStatus).toBe('Interested');
        expect(fx.reads).toEqual([LEAD, LEAD]);
    });
});
