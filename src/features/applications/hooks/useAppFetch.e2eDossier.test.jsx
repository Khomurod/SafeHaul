/**
 * `?e2eDossier=loaded` opens the dossier on a made-up record without reading
 * anything, in E2E test mode only: with E2E mode off, or in a production build,
 * the same link reads the record as always.
 *
 * All names and ids below are artificial.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({ e2e: false, reads: [] }));

vi.mock('@lib/runtime/e2eMode', async (importOriginal) => ({
    ...(await importOriginal()),
    get isE2ETestMode() { return fx.e2e; },
}));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'co-1', teamMembers: [] }, currentUserClaims: { roles: { 'co-1': 'recruiter' } } }),
}));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {}, auth: { currentUser: null } }));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('@features/companies', () => ({
    getCompanyProfile: async (companyId) => {
        fx.reads.push(`company ${companyId}`);
        return { id: companyId, teamMembers: [] };
    },
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    query: (base) => base,
    where: () => ({}),
    getDocs: async () => ({ docs: [] }),
    doc: (_db, ...path) => ({ path: path.join('/') }),
    getDoc: async (ref) => {
        fx.reads.push(`doc ${ref.path}`);
        return { exists: () => true, data: () => ({ firstName: 'Stored', lastName: 'Record', status: 'New Application' }) };
    },
}));

import { useAppFetch } from './useAppFetch';

beforeEach(() => {
    window.history.replaceState(null, '', '/company/drivers/applications?e2eDossier=loaded');
});

afterEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState(null, '', '/');
    Object.assign(fx, { e2e: false, reads: [] });
});

describe('the e2eDossier=loaded fixture', () => {
    it('opens the made-up record, loaded, and reads nothing in E2E test mode', async () => {
        fx.e2e = true;
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('');
        expect(result.current.appData).toMatchObject({ firstName: 'Maximiliano Alejandro', lastName: 'Castellanos-Whitfield' });
        expect(result.current.appData.employers).toHaveLength(2);
        expect(result.current.currentStatus).toBe('Contact Attempt 2');
        expect(result.current.assignedTo).toBe('e2e-company_admin');
        expect(result.current.collectionName).toBe('applications');
        expect(result.current.filesPending).toBe(false);
        expect(fx.reads).toEqual([]);
    });

    it('is ignored outside E2E test mode: the record is read', async () => {
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));

        await waitFor(() => expect(result.current.appData?.firstName).toBe('Stored'));
        expect(fx.reads).toContain('doc companies/co-1/applications/app-1');
    });

    it('is ignored in a production build, even in E2E test mode', async () => {
        fx.e2e = true;
        vi.stubEnv('PROD', true);
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));

        await waitFor(() => expect(result.current.appData?.firstName).toBe('Stored'));
        expect(fx.reads).toContain('doc companies/co-1/applications/app-1');
    });

    it('needs its own value: E2E test mode alone reads the record', async () => {
        fx.e2e = true;
        window.history.replaceState(null, '', '/company/drivers/applications?e2eDossier=mock');
        const { result } = renderHook(() => useAppFetch('co-1', 'app-1'));

        await waitFor(() => expect(result.current.appData?.firstName).toBe('Stored'));
        expect(fx.reads).toContain('doc companies/co-1/applications/app-1');
    });
});
