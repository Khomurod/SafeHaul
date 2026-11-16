/**
 * The dossier opens on the record. The company profile and the record are read
 * at the same time, and the driver's files are signed once the record shows, all
 * of them in one `getSignedApplicationFileUrls` call: `filesPending` says so
 * until their links have arrived. A file the server refuses falls back alone; if
 * the call itself fails, each file is signed on its own, as before. A late answer
 * for a record the dossier no longer shows changes nothing. A file's link is
 * reused when the same record opens again within ten minutes.
 *
 * All names, paths and ids below are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({ reads: [], company: null, signs: [], extraFiles: false }));

const UPLOAD = 'companies/co-1/applications/guest_uploads/app-1/cdl-front.jpg';
const MEDICAL = 'companies/co-1/applications/guest_uploads/app-1/medical.pdf';

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'co-1', teamMembers: [] }, currentUserClaims: { roles: { 'co-1': 'recruiter' } } }),
}));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {}, auth: { currentUser: null } }));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('@features/companies', () => ({
    getCompanyProfile: (companyId) => {
        fx.reads.push(`company ${companyId}`);
        return fx.company ?? Promise.resolve({ id: companyId, teamMembers: [] });
    },
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (payload) => new Promise((resolve, reject) => fx.signs.push({ name, payload, resolve, reject })),
}));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), getDownloadURL: vi.fn(async () => { throw new Error('no client read'); }), getBlob: vi.fn(async () => { throw new Error('no client read'); }) }));
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
                    ...(fx.extraFiles ? {
                        'medical-card-upload': { name: 'medical.pdf', storagePath: MEDICAL.replace('app-1', id) },
                        'mvr-upload': { name: 'mvr.pdf', url: 'https://storage.example.test/mvr-stored' },
                    } : {}),
                }),
            }
            : { exists: () => false };
    },
}));

import { useAppFetch } from './useAppFetch';
import { forgetApplicationFileLinks } from '@features/applications/services/applicationFileLink';

afterEach(() => {
    forgetApplicationFileLinks();
    Object.assign(fx, { reads: [], company: null, signs: [], extraFiles: false });
});

const signedUrl = (id) => `https://storage.example.test/signed/${id}`;
const answer = (links) => ({ data: { success: true, results: links } });

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
        await act(async () => fx.signs[0].resolve(answer({ [UPLOAD]: { url: signedUrl('app-1') } })));
        expect(result.current.filesPending).toBe(false);
    });

    it('shows before its files are signed, and its files follow', async () => {
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.appData.firstName).toBe('Ann');
        expect(result.current.filesPending).toBe(true);
        expect(result.current.fileUrls).toEqual({});

        await waitFor(() => expect(fx.signs).toHaveLength(1));
        expect(fx.signs[0]).toMatchObject({ name: 'getSignedApplicationFileUrls', payload: { storagePaths: [UPLOAD] } });
        await act(async () => fx.signs[0].resolve(answer({ [UPLOAD]: { url: signedUrl('app-1') } })));

        await waitFor(() => expect(result.current.fileUrls['cdl-front']).toBe(signedUrl('app-1')));
        expect(result.current.filesPending).toBe(false);
    });

    it("signs all of the record's driver uploads in one call", async () => {
        fx.extraFiles = true;
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));

        await waitFor(() => expect(fx.signs).toHaveLength(1));
        expect(fx.signs[0]).toMatchObject({ name: 'getSignedApplicationFileUrls', payload: { storagePaths: [UPLOAD, MEDICAL] } });
        await act(async () => fx.signs[0].resolve(answer({
            [UPLOAD]: { url: signedUrl('cdl') },
            [MEDICAL]: { url: signedUrl('medical') },
        })));

        await waitFor(() => expect(result.current.filesPending).toBe(false));
        expect(result.current.fileUrls).toMatchObject({
            'cdl-front': signedUrl('cdl'),
            'medical-card-upload': signedUrl('medical'),
            // A file with no storage path keeps the link it was saved with.
            'mvr-upload': 'https://storage.example.test/mvr-stored',
            'cdl-back': null,
        });
        expect(fx.signs).toHaveLength(1);
    });

    it('falls back for a file the server refuses, and keeps the others', async () => {
        fx.extraFiles = true;
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));

        await waitFor(() => expect(fx.signs).toHaveLength(1));
        await act(async () => fx.signs[0].resolve(answer({
            [UPLOAD]: { url: signedUrl('cdl') },
            [MEDICAL]: { error: { code: 'not-found', message: 'The requested file does not exist.' } },
        })));

        await waitFor(() => expect(result.current.filesPending).toBe(false));
        expect(result.current.fileUrls['cdl-front']).toBe(signedUrl('cdl'));
        // The client read fails here too, and the upload had no stored link.
        expect(result.current.fileUrls['medical-card-upload']).toBeNull();
        expect(fx.signs).toHaveLength(1);
    });

    it('signs each file on its own when the call itself fails', async () => {
        fx.extraFiles = true;
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));

        await waitFor(() => expect(fx.signs).toHaveLength(1));
        await act(async () => fx.signs[0].reject(Object.assign(new Error('not found'), { code: 'functions/not-found' })));

        await waitFor(() => expect(fx.signs).toHaveLength(3));
        expect(fx.signs.slice(1).map(({ name, payload }) => [name, payload])).toEqual([
            ['getSignedApplicationFileUrl', { storagePath: UPLOAD }],
            ['getSignedApplicationFileUrl', { storagePath: MEDICAL }],
        ]);
        await act(async () => {
            fx.signs[1].resolve({ data: { url: signedUrl('cdl') } });
            fx.signs[2].resolve({ data: { url: signedUrl('medical') } });
        });

        await waitFor(() => expect(result.current.filesPending).toBe(false));
        expect(result.current.fileUrls['cdl-front']).toBe(signedUrl('cdl'));
        expect(result.current.fileUrls['medical-card-upload']).toBe(signedUrl('medical'));
    });

    it('keeps the links of the record it shows when an earlier record answers late', async () => {
        const { result, rerender } = renderHook(({ id }) => useAppFetch('co-1', id), { initialProps: { id: 'app-1' } });
        await waitFor(() => expect(fx.signs).toHaveLength(1));

        rerender({ id: 'app-2' });
        await waitFor(() => expect(fx.signs).toHaveLength(2));
        const second = UPLOAD.replace('app-1', 'app-2');
        await act(async () => fx.signs[1].resolve(answer({ [second]: { url: signedUrl('app-2') } })));
        await act(async () => fx.signs[0].resolve(answer({ [UPLOAD]: { url: signedUrl('app-1') } })));

        expect(result.current.appData.firstName).toBe('Ben');
        expect(result.current.fileUrls['cdl-front']).toBe(signedUrl('app-2'));
        expect(result.current.filesPending).toBe(false);
    });

    it('reopened within ten minutes, shows the link it already has without signing again', async () => {
        const first = renderHook(() => useAppFetch('co-1', 'app-1'));
        await waitFor(() => expect(fx.signs).toHaveLength(1));
        await act(async () => fx.signs[0].resolve(answer({ [UPLOAD]: { url: signedUrl('app-1') } })));
        await waitFor(() => expect(first.result.current.fileUrls['cdl-front']).toBe(signedUrl('app-1')));
        first.unmount();

        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));
        await waitFor(() => expect(result.current.fileUrls['cdl-front']).toBe(signedUrl('app-1')));
        expect(result.current.filesPending).toBe(false);
        expect(fx.signs).toHaveLength(1);
        expect(fx.reads.filter((read) => read === 'doc companies/co-1/applications/app-1')).toHaveLength(2);
    });
});
