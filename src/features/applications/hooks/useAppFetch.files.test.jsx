/**
 * The dossier opens on the record. The company profile and the record are read
 * at the same time, and the driver's files are signed once the record shows:
 * `filesPending` says so until their links have arrived. A late answer for a
 * record the dossier no longer shows changes nothing.
 *
 * All names, paths and ids below are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({ reads: [], company: null, signs: [] }));

const UPLOAD = 'companies/co-1/applications/guest_uploads/app-1/cdl-front.jpg';

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'co-1', teamMembers: [] }, currentUserClaims: { roles: { 'co-1': 'recruiter' } } }),
}));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('@features/companies', () => ({
    getCompanyProfile: (companyId) => {
        fx.reads.push(`company ${companyId}`);
        return fx.company ?? Promise.resolve({ id: companyId, teamMembers: [] });
    },
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: () => (payload) => new Promise((resolve) => fx.signs.push({ payload, resolve })),
}));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    query: (base) => base,
    where: () => ({}),
    getDocs: async () => ({ docs: [] }),
    doc: (_db, ...path) => ({ path: path.join('/') }),
    getDoc: async (ref) => {
        fx.reads.push(`doc ${ref.path}`);
        const id = ref.path.split('/').pop();
        return ref.path.includes('/applications/')
            ? {
                exists: () => true,
                data: () => ({
                    firstName: id === 'app-1' ? 'Ann' : 'Ben',
                    status: 'New Application',
                    'cdl-front': { name: 'cdl-front.jpg', url: 'https://storage.example.test/expired', storagePath: UPLOAD.replace('app-1', id) },
                }),
            }
            : { exists: () => false };
    },
}));

import { useAppFetch } from './useAppFetch';

afterEach(() => {
    Object.assign(fx, { reads: [], company: null, signs: [] });
});

const signedUrl = (id) => `https://storage.example.test/signed/${id}`;

describe('the dossier record', () => {
    it('is read at the same time as the company profile', async () => {
        let releaseCompany;
        fx.company = new Promise((resolve) => { releaseCompany = resolve; });
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));

        await waitFor(() => expect(fx.reads).toContain('doc companies/co-1/applications/app-1'));
        expect(fx.reads).toContain('company co-1');

        // The load runs to its end, so nothing it started outlives the test.
        await act(async () => releaseCompany({ id: 'co-1', teamMembers: [] }));
        await waitFor(() => expect(fx.signs).toHaveLength(1));
        await act(async () => fx.signs[0].resolve({ data: { url: signedUrl('app-1') } }));
        expect(result.current.filesPending).toBe(false);
    });

    it('shows before its files are signed, and its files follow', async () => {
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.appData.firstName).toBe('Ann');
        expect(result.current.filesPending).toBe(true);
        expect(result.current.fileUrls).toEqual({});

        await waitFor(() => expect(fx.signs).toHaveLength(1));
        expect(fx.signs[0].payload).toEqual({ storagePath: UPLOAD });
        await act(async () => fx.signs[0].resolve({ data: { url: signedUrl('app-1') } }));

        expect(result.current.filesPending).toBe(false);
        expect(result.current.fileUrls['cdl-front']).toBe(signedUrl('app-1'));
    });

    it('keeps the links of the record it shows when an earlier record answers late', async () => {
        const { result, rerender } = renderHook(({ id }) => useAppFetch('co-1', id), { initialProps: { id: 'app-1' } });
        await waitFor(() => expect(fx.signs).toHaveLength(1));

        rerender({ id: 'app-2' });
        await waitFor(() => expect(fx.signs).toHaveLength(2));
        await act(async () => fx.signs[1].resolve({ data: { url: signedUrl('app-2') } }));
        await act(async () => fx.signs[0].resolve({ data: { url: signedUrl('app-1') } }));

        expect(result.current.appData.firstName).toBe('Ben');
        expect(result.current.fileUrls['cdl-front']).toBe(signedUrl('app-2'));
        expect(result.current.filesPending).toBe(false);
    });
});
