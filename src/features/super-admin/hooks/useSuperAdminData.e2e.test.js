/**
 * The `e2eCompanies=mock` fixture: the companies and users lists show made-up records
 * without reading Firestore, and only in E2E test mode.
 *
 * All ids and names below are synthetic test fixtures.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const e2e = vi.hoisted(() => ({ on: false, param: '' }));
vi.mock('@lib/runtime/e2eMode', () => ({
    get isE2ETestMode() { return e2e.on; },
    getE2EQueryParam: () => e2e.param,
}));
const getDocs = vi.fn(async () => ({ docs: [], empty: true, forEach: () => {} }));
const getCountFromServer = vi.fn(async () => ({ data: () => ({ count: 0 }) }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, name) => ({ __coll: name }),
    collectionGroup: (_db, name) => ({ __group: name }),
    orderBy: vi.fn(),
    limit: vi.fn(),
    where: vi.fn(),
    startAfter: vi.fn(),
    query: (...parts) => ({ __query: true, parts }),
    getDocs: (...a) => getDocs(...a),
    getCountFromServer: (...a) => getCountFromServer(...a),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showError: vi.fn() }),
}));

import { useSuperAdminData } from './useSuperAdminData';
import { mockCompanies, mockUsers } from '../components/companiesMock';

async function mountLoaded() {
    const hook = renderHook(() => useSuperAdminData());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
}

afterEach(() => {
    e2e.on = false;
    e2e.param = '';
    vi.clearAllMocks();
});

describe('useSuperAdminData — the e2eCompanies fixture', () => {
    it('lists the made-up companies, reading nothing, in E2E test mode with e2eCompanies=mock', async () => {
        e2e.on = true;
        e2e.param = 'mock';
        const { result } = await mountLoaded();
        expect(result.current.companyList).toEqual(mockCompanies());
        expect(result.current.hasMoreCompanies).toBe(false);
        expect(result.current.userList).toEqual(mockUsers());
        expect(result.current.hasMoreUsers).toBe(false);
        expect(result.current.allCompaniesMap.get('e2e-co-1')).toBe('Artificial Freight Lines');
        expect(getDocs).not.toHaveBeenCalled();
        expect(getCountFromServer).not.toHaveBeenCalled();
    });

    it('reads Firestore as usual outside E2E test mode, whatever the address says', async () => {
        e2e.param = 'mock';
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = await mountLoaded();
        expect(getDocs).toHaveBeenCalled();
        expect(result.current.companyList).toEqual([]);
    });
});
