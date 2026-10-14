/**
 * The owner panel names every company, and reads its users past the first 50.
 *
 * The company map (the names beside a membership or an application, and the
 * companies the membership picker offers) was built from the companies table's
 * first page of 20, so the 21st company showed as "Unknown Company" and could
 * not be picked. The users list stopped at 50, with no way to read more.
 *
 * All ids and names below are synthetic test fixtures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

let companyCount = 25;
let userCount = 50;
let failEveryCompany = false;
let nextUsers = [];

function snap(docs) {
    return { docs, empty: docs.length === 0, forEach: (cb) => docs.forEach(cb) };
}
function companyDoc(i) {
    return { id: `co-${i}`, data: () => ({ companyName: `Artificial Carrier ${i}`, createdAt: { seconds: 1000 - i } }) };
}
function userDoc(id) {
    return { id, data: () => ({ name: `Artificial User ${id}`, createdAt: { seconds: 1 } }) };
}

const getDocs = vi.fn(async (target) => {
    if (target?.__coll === 'companies') {
        if (failEveryCompany) throw new Error('simulated companies read failure');
        return snap(Array.from({ length: companyCount }, (_, i) => companyDoc(i)));
    }
    const parts = target?.parts || [];
    const coll = parts.find((p) => p?.__coll)?.__coll;
    const cursor = parts.find((p) => p?.__op === 'startAfter')?.cursor;
    const membershipIds = parts.find((p) => p?.__op === 'where')?.a?.[2];
    if (coll === 'memberships') {
        return snap(membershipIds
            .filter((id) => id === 'u-late-1')
            .map((userId) => ({ data: () => ({ userId, companyId: 'co-23', role: 'recruiter' }) })));
    }
    if (coll === 'companies') return snap(Array.from({ length: Math.min(companyCount, 20) }, (_, i) => companyDoc(i)));
    if (coll === 'users') {
        if (cursor) return snap(nextUsers.map(userDoc));
        return snap(Array.from({ length: userCount }, (_, i) => userDoc(`u-${i}`)));
    }
    return snap([]);
});

vi.mock('firebase/firestore', () => ({
    collection: (_db, name) => ({ __coll: name }),
    collectionGroup: (_db, name) => ({ __group: name }),
    orderBy: (...a) => ({ __op: 'orderBy', a }),
    limit: (n) => ({ __op: 'limit', n }),
    where: (...a) => ({ __op: 'where', a }),
    startAfter: (cursor) => ({ __op: 'startAfter', cursor }),
    query: (...parts) => ({ __query: true, parts }),
    getDocs: (...a) => getDocs(...a),
    getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showError: vi.fn() }),
}));

import { useSuperAdminData } from './useSuperAdminData';

async function mountLoaded() {
    const hook = renderHook(() => useSuperAdminData());
    await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 3000 });
    return hook;
}

beforeEach(() => {
    vi.clearAllMocks();
    companyCount = 25;
    userCount = 50;
    failEveryCompany = false;
    nextUsers = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useSuperAdminData — every company named', () => {
    it('names all 25 companies, though the table shows its first page of 20', async () => {
        const { result } = await mountLoaded();
        expect(result.current.companyList).toHaveLength(20);
        expect(result.current.allCompaniesMap.size).toBe(25);
        expect(result.current.allCompaniesMap.get('co-23')).toBe('Artificial Carrier 23');
    });

    it('still names the page\'s companies when every company could not be read', async () => {
        failEveryCompany = true;
        const { result } = await mountLoaded();
        expect(result.current.allCompaniesMap.size).toBe(20);
        expect(result.current.allCompaniesMap.get('co-0')).toBe('Artificial Carrier 0');
    });
});

describe('useSuperAdminData — users past the first 50', () => {
    it('reads the users after the last one shown, with their memberships, and adds them', async () => {
        nextUsers = ['u-late-1', 'u-late-2'];
        const { result } = await mountLoaded();
        expect(result.current.userList).toHaveLength(50);
        expect(result.current.hasMoreUsers).toBe(true);

        await act(async () => { await result.current.loadMore('users'); });

        const nextPage = getDocs.mock.calls
            .map(([target]) => target?.parts || [])
            .find((parts) => parts.some((p) => p?.__coll === 'users') && parts.some((p) => p?.__op === 'startAfter'));
        expect(nextPage.find((p) => p?.__op === 'startAfter').cursor.id).toBe('u-49');
        expect(nextPage.find((p) => p?.__op === 'limit').n).toBe(50);

        expect(result.current.userList).toHaveLength(52);
        expect(result.current.userList[50]).toMatchObject({
            id: 'u-late-1',
            memberships: [{ userId: 'u-late-1', companyId: 'co-23', role: 'recruiter' }],
        });
        expect(result.current.userList[51].memberships).toEqual([]);
        expect(result.current.hasMoreUsers).toBe(false);
    });

    it('offers no more users when the first page holds fewer than 50', async () => {
        userCount = 12;
        const { result } = await mountLoaded();
        expect(result.current.userList).toHaveLength(12);
        expect(result.current.hasMoreUsers).toBe(false);
    });
});
