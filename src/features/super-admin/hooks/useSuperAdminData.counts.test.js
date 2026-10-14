/**
 * The dashboard's platform counts: applications and leads are counted apart,
 * and a count that fails is flagged by its own name rather than read as 0.
 * "Total Applications" read the leads' count, and only the lists' failures were
 * flagged.
 *
 * All ids and names below are synthetic test fixtures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const COUNTS = { companies: 3, users: 5, applications: 7, leads: 11 };
let failingCount = null;

const getCountFromServer = vi.fn(async (target) => {
    const name = target?.__coll || target?.__group;
    if (name === failingCount) throw new Error(`simulated ${name} count failure`);
    return { data: () => ({ count: COUNTS[name] }) };
});

vi.mock('firebase/firestore', () => ({
    collection: (_db, name) => ({ __coll: name }),
    collectionGroup: (_db, name) => ({ __group: name }),
    orderBy: (...a) => ({ __op: 'orderBy', a }),
    limit: (n) => ({ __op: 'limit', n }),
    where: (...a) => ({ __op: 'where', a }),
    startAfter: (cursor) => ({ __op: 'startAfter', cursor }),
    query: (...parts) => ({ __query: true, parts }),
    getDocs: async () => ({ docs: [], empty: true, forEach: () => {} }),
    getCountFromServer: (...a) => getCountFromServer(...a),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showError: vi.fn() }),
}));
vi.mock('@/context/dataContext/sessionKeys', () => ({
    SESSION_KEYS: { PLATFORM_STATS: 'test-platform-stats' },
}));

import { useSuperAdminData } from './useSuperAdminData';

async function mountLoaded() {
    const hook = renderHook(() => useSuperAdminData());
    await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 3000 });
    return hook;
}

beforeEach(() => {
    vi.clearAllMocks();
    failingCount = null;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useSuperAdminData — platform counts', () => {
    it('counts applications and leads apart', async () => {
        const { result } = await mountLoaded();
        expect(result.current.stats).toEqual({ companyCount: 3, userCount: 5, appCount: 7, leadCount: 11 });
        expect(getCountFromServer).toHaveBeenCalledWith({ __group: 'applications' });
        expect(getCountFromServer).toHaveBeenCalledWith({ __group: 'leads' });
    });

    it('flags a count that failed by its own name, and no list with it', async () => {
        failingCount = 'applications';
        const { result } = await mountLoaded();
        expect(result.current.statsError).toEqual({
            companies: false, users: false, apps: false,
            companyCount: false, userCount: false, appCount: true, leadCount: false,
        });
        expect(result.current.stats.leadCount).toBe(11);
    });
});
