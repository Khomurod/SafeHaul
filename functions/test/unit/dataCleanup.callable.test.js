/**
 * The `dataCleanup` callable itself: Super Admin only, a run only after a
 * recent sign-in, a value-free audit record per run, and an answer that
 * arrives inside the function's time with `done: false` when work is left.
 *
 * Every account and record below is artificial.
 */
jest.mock('firebase-functions/v2/https', () => require('./dataCleanup.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./dataCleanup.support').world.firebaseAdmin);

const { world, request, SUPER_ADMIN } = require('./dataCleanup.support');
const { dataCleanup, __private } = require('../../maintenance/dataCleanup');
const { PAGE_SIZE } = require('../../maintenance/cleanup/shared');

const SEED = {
    firestore: {
        'drivers/d1': { personalInfo: { ssn: 'plain-1' } },
        'drivers/d1/pending_updates/p1': { proposedChanges: { personalInfo: { ssn: 'cipher-1' } } },
    },
};

describe('dataCleanup', () => {
    beforeEach(() => world.reset(SEED));
    afterEach(() => jest.restoreAllMocks());

    it.each([
        ['nobody signed in', undefined, 'unauthenticated'],
        ['a company admin', { uid: 'admin-1', token: { roles: { c1: 'company_admin' }, auth_time: Math.floor(Date.now() / 1000) } }, 'permission-denied'],
        ['a claim under the wrong name', { uid: 'admin-2', token: { super_admin: true } }, 'permission-denied'],
    ])('refuses %s, for a check and for a run, without writing', async (_label, auth, code) => {
        for (const mode of ['check', 'run']) {
            await expect(dataCleanup({ auth, data: { mode, item: 'ssnCopies' } })).rejects.toMatchObject({ code });
        }
        expect(world.writes).toBe(0);
        expect(world.doc('drivers/d1').personalInfo.ssn).toBe('plain-1');
    });

    it.each([
        [{ mode: 'check' }],
        [{ mode: 'delete', item: 'ssnCopies' }],
        [{ mode: 'run', item: 'everything' }],
        [{ mode: 'check', item: '__proto__' }],
        [{ mode: 'check', item: 'hasOwnProperty' }],
    ])('refuses an unknown item or mode: %j', async (data) => {
        await expect(dataCleanup(request(data))).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('runs only after a recent sign-in; a check does not need one', async () => {
        const stale = { uid: 'owner-uid', token: { globalRole: 'super_admin', auth_time: Math.floor(Date.now() / 1000) - 3600 } };
        await expect(dataCleanup(request({ mode: 'run', item: 'ssnCopies' }, stale)))
            .rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringContaining('REAUTH_REQUIRED') });
        expect(world.writes).toBe(0);

        await expect(dataCleanup(request({ mode: 'check', item: 'ssnCopies' }, stale)))
            .resolves.toMatchObject({ total: 2 });
    });

    it('records each run in the audit trail, with counts and no value', async () => {
        await dataCleanup(request({ mode: 'check', item: 'ssnCopies' }));
        expect(world.audit).toEqual([]);

        await dataCleanup(request({ mode: 'run', item: 'ssnCopies' }));
        expect(world.audit).toEqual([expect.objectContaining({
            collection: 'environment_audit_log',
            actorUid: SUPER_ADMIN().uid,
            action: 'data-cleanup',
            result: 'success',
            item: 'ssnCopies',
            mode: 'run',
            count: 2,
            done: true,
        })]);
        expect(JSON.stringify(world.audit)).not.toMatch(/plain-1|cipher-1/);
    });

    it('answers done: false at the time budget, and the next run finishes', async () => {
        const firestore = {};
        for (let i = 0; i < PAGE_SIZE + 3; i += 1) firestore[`drivers/d${String(i).padStart(4, '0')}`] = { personalInfo: { ssn: `plain-${i}` } };
        world.reset({ firestore });

        // The clock passes the budget once the first page of driver profiles is read.
        let now = 1000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        world.afterQuery = (snaps) => {
            if (snaps.length === PAGE_SIZE) now += __private.TIME_BUDGET_MS;
        };
        const owner = { uid: 'owner-uid', token: { globalRole: 'super_admin', auth_time: now / 1000 } };

        const first = await dataCleanup(request({ mode: 'run', item: 'ssnCopies' }, owner));
        expect(first).toMatchObject({ done: false, counts: { driverProfiles: PAGE_SIZE } });

        jest.restoreAllMocks();
        world.afterQuery = null;
        const second = await dataCleanup(request({ mode: 'run', item: 'ssnCopies' }));
        expect(second).toMatchObject({ done: true, counts: { driverProfiles: 3 } });
        expect([...world.docs.values()].some((data) => data.personalInfo?.ssn)).toBe(false);
    });

    it('reports a failure without its detail, and audits it', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(__private.ITEMS.ssnCopies, 'sweep').mockImplementation(async () => {
            throw new Error('drivers/d1 personalInfo.ssn plain-1');
        });
        const failure = dataCleanup(request({ mode: 'run', item: 'ssnCopies' }));
        await expect(failure).rejects.toMatchObject({ code: 'internal' });
        await expect(failure).rejects.not.toMatchObject({ message: expect.stringContaining('plain-1') });
        expect(world.audit).toEqual([expect.objectContaining({ result: 'failed', item: 'ssnCopies' })]);
    });
});
