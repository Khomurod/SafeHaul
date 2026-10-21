/**
 * Data cleanup → application search fields, by the rule of
 * `backfillApplicationSearchFields`: written where missing or out of date,
 * never on leads.
 *
 * Every name, address and number below is artificial.
 */
jest.mock('firebase-functions/v2/https', () => require('./dataCleanup.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./dataCleanup.support').world.firebaseAdmin);

const { world, request } = require('./dataCleanup.support');
const { dataCleanup, __private } = require('../../maintenance/dataCleanup');
const { buildApplicationSearchFields } = require('../../shared/searchNormalization');

const check = () => dataCleanup(request({ mode: 'check', item: 'searchFields' }));
const run = () => dataCleanup(request({ mode: 'run', item: 'searchFields' }));

const ADA = { firstName: 'Ada', lastName: 'Byron', email: 'Ada@Example.test', phone: '1-555-010-0001', confirmationNumber: 'saf-2026-00001' };
const adaFields = buildApplicationSearchFields({ ...ADA, applicationId: 'app1' });

function seed() {
    world.reset({
        firestore: {
            'companies/c1': { companyName: 'Carrier One' },
            'companies/c1/applications/app1': { ...ADA, status: 'New' },
            'companies/c1/applications/app2': {
                firstName: 'Ben', lastName: 'Cole',
                ...buildApplicationSearchFields({ firstName: 'Ben', lastName: 'Cole', applicationId: 'app2' }),
            },
            'companies/c1/leads/lead1': { firstName: 'Cy', lastName: 'Dale' },
        },
    });
}

describe('data cleanup — application search fields', () => {
    beforeEach(seed);

    it('counts without writing', async () => {
        const result = await check();
        expect(result).toMatchObject({ done: true, counts: { applications: 1 }, total: 1 });
        expect(world.writes).toBe(0);
    });

    it('merges the search fields into the application that lacks them', async () => {
        await run();
        expect(world.doc('companies/c1/applications/app1')).toEqual({ ...ADA, status: 'New', ...adaFields });
        expect(adaFields.phoneNormalized).toBe('5550100001');
        expect(world.doc('companies/c1/leads/lead1')).toEqual({ firstName: 'Cy', lastName: 'Dale' });
        expect(world.writes).toBe(1);
    });

    it('changes nothing on a second run', async () => {
        await run();
        world.writes = 0;
        expect((await run()).total).toBe(0);
        expect(world.writes).toBe(0);
    });

    it('stops at the time budget without writing', async () => {
        const result = await __private.execute({ item: 'searchFields', mode: 'run', outOfTime: () => true });
        expect(result.done).toBe(false);
        expect(world.writes).toBe(0);
    });
});
