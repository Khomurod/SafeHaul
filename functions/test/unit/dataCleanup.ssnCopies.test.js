/**
 * Data cleanup → old SSN copies: the encrypted copy in each driver's
 * `pending_updates` and the plain-text one on the driver profile. Only that
 * field goes; everything else on the document stays.
 *
 * Every value below is artificial; none is a real SSN or ciphertext.
 */
jest.mock('firebase-functions/v2/https', () => require('./dataCleanup.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./dataCleanup.support').world.firebaseAdmin);

const { world, request } = require('./dataCleanup.support');
const { dataCleanup, __private } = require('../../maintenance/dataCleanup');
const { PAGE_SIZE } = require('../../maintenance/cleanup/shared');

const check = () => dataCleanup(request({ mode: 'check', item: 'ssnCopies' }));
const run = () => dataCleanup(request({ mode: 'run', item: 'ssnCopies' }));

function seed() {
    world.reset({
        firestore: {
            'drivers/d1': { personalInfo: { firstName: 'Ada', ssn: '000-00-0000', phone: '5550100' }, companyIds: ['c1'] },
            'drivers/d2': { personalInfo: { firstName: 'Ben', ssn: '' } },
            'drivers/d3': { personalInfo: { firstName: 'Cy' } },
            'drivers/d1/pending_updates/p1': {
                source: 'application',
                proposedChanges: { personalInfo: { firstName: 'Ada', ssn: 'aa11:ffee' }, licenses: [] },
            },
            'drivers/d1/pending_updates/p2': { proposedChanges: { personalInfo: { firstName: 'Ada', ssn: null } } },
            'drivers/d3/pending_updates/p3': { proposedChanges: { personalInfo: { firstName: 'Cy' } } },
            // A collection of the same name elsewhere is not driver staging.
            'companies/c1/pending_updates/x1': { proposedChanges: { personalInfo: { ssn: 'keep' } } },
        },
    });
}

describe('data cleanup — SSN copies', () => {
    beforeEach(seed);

    it('counts without writing', async () => {
        const result = await check();
        expect(result).toMatchObject({ done: true, counts: { pendingUpdates: 1, driverProfiles: 1 }, total: 2 });
        expect(world.writes).toBe(0);
    });

    it('deletes only the SSN field, where it holds a value', async () => {
        await run();
        expect(world.doc('drivers/d1')).toEqual({ personalInfo: { firstName: 'Ada', phone: '5550100' }, companyIds: ['c1'] });
        expect(world.doc('drivers/d1/pending_updates/p1')).toEqual({
            source: 'application',
            proposedChanges: { personalInfo: { firstName: 'Ada' }, licenses: [] },
        });
        expect(world.doc('drivers/d2')).toEqual({ personalInfo: { firstName: 'Ben', ssn: '' } });
        expect(world.doc('drivers/d1/pending_updates/p2').proposedChanges.personalInfo.ssn).toBeNull();
        expect(world.doc('companies/c1/pending_updates/x1').proposedChanges.personalInfo.ssn).toBe('keep');
        expect(world.writes).toBe(2);
    });

    it('changes nothing on a second run', async () => {
        await run();
        world.writes = 0;
        expect((await run()).total).toBe(0);
        expect(world.writes).toBe(0);
    });

    it('stops at the time budget, and the next run goes on', async () => {
        const firestore = {};
        for (let i = 0; i < PAGE_SIZE + 5; i += 1) {
            firestore[`drivers/d${String(i).padStart(4, '0')}`] = { personalInfo: { ssn: `plain-${i}` } };
        }
        world.reset({ firestore });

        // The staging scan reads one empty page, the profile scan one full page, then the time is up.
        let calls = 0;
        const stopped = await __private.execute({ item: 'ssnCopies', mode: 'run', outOfTime: () => calls++ > 1 });
        expect(stopped).toMatchObject({ done: false, counts: { driverProfiles: PAGE_SIZE } });
        const rest = await __private.execute({ item: 'ssnCopies', mode: 'run', outOfTime: () => false });
        expect(rest).toMatchObject({ done: true, counts: { driverProfiles: 5 } });
    });

    it('writes nothing when the budget is already spent', async () => {
        const result = await __private.execute({ item: 'ssnCopies', mode: 'run', outOfTime: () => true });
        expect(result.done).toBe(false);
        expect(world.writes).toBe(0);
    });
});
