/**
 * Data cleanup → DQ valid-until dates: `dqExpiresNext` written on every
 * application and lead whose DQ file disagrees with it, by the rule the DQ
 * trigger keeps since (`shared/dqExpiry.js`): the earliest `expirationDate`
 * among records not removed, and no field when none has one.
 *
 * Every name and id below is artificial.
 */
jest.mock('firebase-functions/v2/https', () => require('./dataCleanup.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./dataCleanup.support').world.firebaseAdmin);

const { world, request } = require('./dataCleanup.support');
const { dataCleanup, __private } = require('../../maintenance/dataCleanup');

const check = () => dataCleanup(request({ mode: 'check', item: 'dqExpiry' }));
const run = () => dataCleanup(request({ mode: 'run', item: 'dqExpiry' }));

const APPS = 'companies/c1/applications';
const LEADS = 'companies/c1/leads';

function seed() {
    world.reset({
        firestore: {
            'companies/c1': { companyName: 'Carrier One' },
            // Filed before the field existed: a medical card and a licence.
            [`${APPS}/app1`]: { firstName: 'Ada', status: 'Hired' },
            [`${APPS}/app1/dq_files/medical_card`]: { type: 'Medical Card', expirationDate: '2026-12-01' },
            [`${APPS}/app1/dq_files/license_front`]: { type: 'CDL', expirationDate: '2027-05-10' },
            // Already right.
            [`${APPS}/app2`]: { firstName: 'Ben', dqExpiresNext: '2027-01-15' },
            [`${APPS}/app2/dq_files/mvr`]: { type: 'MVR (Annual)', expirationDate: '2027-01-15' },
            // Stale: its only dated record was removed.
            [`${APPS}/app3`]: { firstName: 'Cy', dqExpiresNext: '2025-03-01' },
            [`${APPS}/app3/dq_files/medical_card`]: { type: 'Medical Card', expirationDate: '2025-03-01', removedAt: 'then' },
            // No DQ file at all, and no field: nothing to do.
            [`${APPS}/app4`]: { firstName: 'Dee' },
            // A lead, filed before the field existed.
            [`${LEADS}/lead1`]: { firstName: 'Eve' },
            [`${LEADS}/lead1/dq_files/twic_card`]: { type: 'TWIC Card', expirationDate: '2026-11-30' },
        },
    });
}

describe('data cleanup — DQ valid-until dates', () => {
    beforeEach(seed);

    it('counts the applications and leads to change, without writing', async () => {
        const result = await check();
        expect(result).toMatchObject({ done: true, counts: { applications: 2, leads: 1 }, total: 3 });
        expect(world.writes).toBe(0);
    });

    it('writes the earliest date, and removes one no record holds any more', async () => {
        await run();
        expect(world.doc(`${APPS}/app1`)).toEqual({ firstName: 'Ada', status: 'Hired', dqExpiresNext: '2026-12-01' });
        expect(world.doc(`${APPS}/app2`)).toEqual({ firstName: 'Ben', dqExpiresNext: '2027-01-15' });
        expect(world.doc(`${APPS}/app3`)).toEqual({ firstName: 'Cy' });
        expect(world.doc(`${APPS}/app4`)).toEqual({ firstName: 'Dee' });
        expect(world.doc(`${LEADS}/lead1`)).toEqual({ firstName: 'Eve', dqExpiresNext: '2026-11-30' });
        // The DQ records themselves are left as they are.
        expect(world.doc(`${APPS}/app1/dq_files/medical_card`)).toEqual({ type: 'Medical Card', expirationDate: '2026-12-01' });
        expect(world.writes).toBe(3);
    });

    it('changes nothing on a second run', async () => {
        await run();
        world.writes = 0;
        expect((await run()).total).toBe(0);
        expect(world.writes).toBe(0);
    });

    it('stops at the time budget without writing', async () => {
        const result = await __private.execute({ item: 'dqExpiry', mode: 'run', outOfTime: () => true });
        expect(result.done).toBe(false);
        expect(world.writes).toBe(0);
    });
});
