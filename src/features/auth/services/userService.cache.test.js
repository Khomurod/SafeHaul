/**
 * The signed-in user's profile is read once per sign-in: the top bar, the
 * dashboard greeting and the notes tab all show its name, and asked for it on
 * every mount. A write forgets the copy, a form that edits the profile reads
 * it fresh, and a failed or missing read is not kept.
 *
 * All names and ids below are artificial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ reads: 0, docs: {}, fail: false, user: null }));

vi.mock('firebase/firestore', () => ({
    doc: (_db, ...path) => path.join('/'),
    getDoc: async (path) => {
        fx.reads += 1;
        if (fx.fail) throw new Error('offline');
        const data = fx.docs[path];
        return { exists: () => Boolean(data), data: () => data };
    },
    collection: vi.fn(),
    getDocs: vi.fn(),
    updateDoc: vi.fn(),
    addDoc: vi.fn(),
    deleteDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: { success: true } }) }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {}, auth: { get currentUser() { return fx.user; } } }));

import { forgetPortalUser, getPortalUser, updateUser } from './userService';

beforeEach(() => {
    forgetPortalUser();
    Object.assign(fx, { reads: 0, fail: false, docs: { 'users/uid-1': { name: 'Ann Admin' } }, user: { uid: 'uid-1' } });
});

describe('the signed-in profile', () => {
    it('is read once, however many screens ask, at once or later', async () => {
        const [topBar, greeting] = await Promise.all([getPortalUser('uid-1'), getPortalUser('uid-1')]);
        const notes = await getPortalUser('uid-1');

        expect(fx.reads).toBe(1);
        expect([topBar, greeting, notes]).toEqual([{ name: 'Ann Admin' }, { name: 'Ann Admin' }, { name: 'Ann Admin' }]);
    });

    it('is read again once a write forgets it', async () => {
        await getPortalUser('uid-1');
        fx.docs['users/uid-1'] = { name: 'Ann Renamed' };
        forgetPortalUser('uid-1');

        expect(await getPortalUser('uid-1')).toEqual({ name: 'Ann Renamed' });
        expect(fx.reads).toBe(2);
    });

    it('is read fresh by a form that edits it, and later screens get that copy', async () => {
        await getPortalUser('uid-1');
        fx.docs['users/uid-1'] = { name: 'Ann Renamed' };

        expect(await getPortalUser('uid-1', { fresh: true })).toEqual({ name: 'Ann Renamed' });
        expect(await getPortalUser('uid-1')).toEqual({ name: 'Ann Renamed' });
        expect(fx.reads).toBe(2);
    });

    it('is read again after a failed read', async () => {
        fx.fail = true;
        await expect(getPortalUser('uid-1')).rejects.toThrow('offline');
        fx.fail = false;

        expect(await getPortalUser('uid-1')).toEqual({ name: 'Ann Admin' });
        expect(fx.reads).toBe(2);
    });

    it('is read again while it does not exist', async () => {
        delete fx.docs['users/uid-1'];
        expect(await getPortalUser('uid-1')).toBeNull();
        fx.docs['users/uid-1'] = { name: 'Ann Admin' };

        expect(await getPortalUser('uid-1')).toEqual({ name: 'Ann Admin' });
        expect(fx.reads).toBe(2);
    });

    it('is read again after the next sign-in, even as the same user', async () => {
        await getPortalUser('uid-1');
        fx.user = { uid: 'uid-1' };
        fx.docs['users/uid-1'] = { name: 'Ann Renamed' };

        expect(await getPortalUser('uid-1')).toEqual({ name: 'Ann Renamed' });
        expect(fx.reads).toBe(2);
    });

    it('is read again once the user is renamed through the server', async () => {
        await getPortalUser('uid-1');
        await updateUser('uid-1', { name: 'Ann Renamed', email: 'ann@example.com' });
        fx.docs['users/uid-1'] = { name: 'Ann Renamed' };

        expect(await getPortalUser('uid-1')).toEqual({ name: 'Ann Renamed' });
        expect(fx.reads).toBe(2);
    });

    it('of another user is never the signed-in one', async () => {
        fx.docs['users/uid-2'] = { name: 'Ben Recruiter' };
        await getPortalUser('uid-1');

        expect(await getPortalUser('uid-2')).toEqual({ name: 'Ben Recruiter' });
        expect(await getPortalUser(undefined)).toBeNull();
    });
});
