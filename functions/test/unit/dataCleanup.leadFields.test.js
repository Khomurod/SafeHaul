/**
 * Data cleanup → old lead fields: an empty `assignedTo`, the import's
 * `normalizedPhone`, and a one-value `driverType` list as a string. A list of
 * several driver types is only counted, never chosen from.
 *
 * Every name and phone number below is artificial.
 */
jest.mock('firebase-functions/v2/https', () => require('./dataCleanup.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./dataCleanup.support').world.firebaseAdmin);

const { world, request } = require('./dataCleanup.support');
const { dataCleanup, __private } = require('../../maintenance/dataCleanup');

const check = () => dataCleanup(request({ mode: 'check', item: 'leadFields' }));
const run = () => dataCleanup(request({ mode: 'run', item: 'leadFields' }));

function seed() {
    world.reset({
        firestore: {
            'companies/c1': { companyName: 'Carrier One' },
            'companies/c1/leads/imported': { assignedTo: null, phone: '+1 (555) 010-0001', driverType: ['Company Driver'] },
            'companies/c1/leads/quickAdd': { firstName: 'Ben', phone: '555-010-0002', normalizedPhone: '', driverType: [] },
            'companies/c1/leads/current': {
                assignedTo: '', phone: '555-010-0003', normalizedPhone: '5550100003', driverType: 'Owner Operator',
            },
            'companies/c1/leads/assigned': { assignedTo: 'recruiter-1', driverType: ['Owner Operator', 'Lease Purchase'] },
            'companies/c1/leads/noDigits': { assignedTo: '', phone: 'n/a' },
            'companies/c2': { companyName: 'Carrier Two' },
            'companies/c2/applications/app1': { assignedTo: null, phone: '5550100009', driverType: ['Team'] },
            'companies/c2/applications/app2': { driverType: 'Solo' },
        },
    });
}

describe('data cleanup — lead fields', () => {
    beforeEach(seed);

    it('counts without writing, and names the records with several driver types', async () => {
        const result = await check();
        expect(result).toMatchObject({
            done: true,
            counts: { assignedTo: 2, normalizedPhone: 2, driverType: 3, driverTypeSeveral: 1 },
            total: 7,
            notes: { driverTypeSeveral: ['companies/c1/leads/assigned'] },
        });
        expect(world.writes).toBe(0);
    });

    it('writes the current shapes and leaves the rest', async () => {
        await run();
        expect(world.doc('companies/c1/leads/imported')).toEqual({
            assignedTo: '', phone: '+1 (555) 010-0001', normalizedPhone: '5550100001', driverType: 'Company Driver',
        });
        expect(world.doc('companies/c1/leads/quickAdd')).toEqual({
            firstName: 'Ben', assignedTo: '', phone: '555-010-0002', normalizedPhone: '5550100002', driverType: '',
        });
        expect(world.doc('companies/c1/leads/assigned')).toEqual({
            assignedTo: 'recruiter-1', driverType: ['Owner Operator', 'Lease Purchase'],
        });
        expect(world.doc('companies/c1/leads/noDigits')).toEqual({ assignedTo: '', phone: 'n/a' });
        // Applications: driver type only.
        expect(world.doc('companies/c2/applications/app1')).toEqual({ assignedTo: null, phone: '5550100009', driverType: 'Team' });
        expect(world.writes).toBe(3);
    });

    it('changes nothing on a second run', async () => {
        await run();
        world.writes = 0;
        const again = await run();
        expect(again.total).toBe(0);
        expect(again.counts.driverTypeSeveral).toBe(1);
        expect(world.writes).toBe(0);
    });

    it('stops at the time budget without writing', async () => {
        const result = await __private.execute({ item: 'leadFields', mode: 'run', outOfTime: () => true });
        expect(result.done).toBe(false);
        expect(world.writes).toBe(0);
    });
});
