/**
 * Data cleanup → old driver staging copies: every `drivers/{id}/pending_updates`
 * document, which driver sync wrote for each application and lead until it
 * stopped and which nothing reads (owner decision В7). The driver profile and
 * a collection of the same name anywhere else are left alone.
 *
 * Every name and id below is artificial.
 */
jest.mock('firebase-functions/v2/https', () => require('./dataCleanup.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./dataCleanup.support').world.firebaseAdmin);

const { world, request } = require('./dataCleanup.support');
const { dataCleanup, __private } = require('../../maintenance/dataCleanup');
const { PAGE_SIZE } = require('../../maintenance/cleanup/shared');

const check = () => dataCleanup(request({ mode: 'check', item: 'pendingUpdates' }));
const run = () => dataCleanup(request({ mode: 'run', item: 'pendingUpdates' }));

function seed() {
    world.reset({
        firestore: {
            'drivers/d1': { personalInfo: { firstName: 'Ada' }, companyIds: ['c1'] },
            'drivers/d1/pending_updates/p1': { source: 'application', proposedChanges: { personalInfo: { firstName: 'Ada' } } },
            'drivers/d1/pending_updates/p2': { source: 'lead' },
            'drivers/d2/pending_updates/p3': { source: 'application' },
            // A collection of the same name elsewhere is not driver staging.
            'companies/c1/pending_updates/x1': { keep: true },
        },
    });
}

describe('data cleanup — old driver staging copies', () => {
    beforeEach(seed);

    it('counts the copies without writing', async () => {
        const result = await check();
        expect(result).toMatchObject({ done: true, counts: { pendingUpdates: 3 }, total: 3 });
        expect(world.writes).toBe(0);
    });

    it('deletes every copy under a driver, and nothing else', async () => {
        await run();
        expect(world.doc('drivers/d1/pending_updates/p1')).toBeUndefined();
        expect(world.doc('drivers/d1/pending_updates/p2')).toBeUndefined();
        expect(world.doc('drivers/d2/pending_updates/p3')).toBeUndefined();
        expect(world.doc('drivers/d1')).toEqual({ personalInfo: { firstName: 'Ada' }, companyIds: ['c1'] });
        expect(world.doc('companies/c1/pending_updates/x1')).toEqual({ keep: true });
        expect(world.writes).toBe(3);
    });

    it('finds nothing on a second run', async () => {
        await run();
        world.writes = 0;
        expect((await run()).total).toBe(0);
        expect(world.writes).toBe(0);
    });

    it('stops at the time budget, and the next run goes on', async () => {
        const firestore = {};
        for (let i = 0; i < PAGE_SIZE + 5; i += 1) {
            firestore[`drivers/d${String(i).padStart(4, '0')}/pending_updates/p`] = { source: 'application' };
        }
        world.reset({ firestore });

        let calls = 0;
        const stopped = await __private.execute({ item: 'pendingUpdates', mode: 'run', outOfTime: () => calls++ > 0 });
        expect(stopped).toMatchObject({ done: false, counts: { pendingUpdates: PAGE_SIZE } });
        const rest = await __private.execute({ item: 'pendingUpdates', mode: 'run', outOfTime: () => false });
        expect(rest).toMatchObject({ done: true, counts: { pendingUpdates: 5 } });
    });

    it('writes nothing when the budget is already spent', async () => {
        const result = await __private.execute({ item: 'pendingUpdates', mode: 'run', outOfTime: () => true });
        expect(result.done).toBe(false);
        expect(world.writes).toBe(0);
    });
});
