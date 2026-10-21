/**
 * Data cleanup → old PEV links: the employer form's token and link come off
 * the employer rows, their history and the PEV request's activity log, on
 * applications and leads. Everything else on the row stays exactly as it was.
 *
 * Every company, employer, link and token below is artificial.
 */
jest.mock('firebase-functions/v2/https', () => require('./dataCleanup.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./dataCleanup.support').world.firebaseAdmin);

const { world, request } = require('./dataCleanup.support');
const { dataCleanup, __private } = require('../../maintenance/dataCleanup');

const check = () => dataCleanup(request({ mode: 'check', item: 'pevLinks' }));
const run = () => dataCleanup(request({ mode: 'run', item: 'pevLinks' }));

const LINK = 'https://portal.example.test/verify/tok-1';
const SENT = { action: 'Sent via Portal', method: 'Manual', recipient: 'Manual Download', timestamp: '2026-01-02T03:04:05.000Z' };

function seed() {
    world.reset({
        firestore: {
            'companies/c1': { companyName: 'Carrier One' },
            'companies/c1/applications/a1': {
                firstName: 'Ada',
                employers: [
                    {
                        employerId: 'emp_1',
                        companyName: 'Old Freight',
                        verification: {
                            status: 'Sent', method: 'Manual', token: 'tok-1', verificationUrl: LINK,
                            history: [{ ...SENT, token: 'tok-1', verificationUrl: LINK }, { action: 'Reminder sent' }],
                        },
                    },
                    { employerId: 'emp_2', companyName: 'No Request Yet' },
                ],
            },
            'companies/c1/applications/a1/activity_logs/l1': {
                action: 'PEV_REQUEST', details: `Initiated Manual verification for Old Freight (Sent to: Manual Download) | Portal: ${LINK}`,
            },
            'companies/c1/applications/a1/activity_logs/l2': {
                action: 'PEV_REQUEST', details: 'Initiated Email verification for Old Freight (Sent to: hr@old-freight.test)',
            },
            'companies/c1/applications/a1/activity_logs/l3': { action: 'NOTE', details: `Called | Portal: ${LINK}` },
            'companies/c1/leads/lead1': {
                employers: [{ employerId: 'emp_3', verification: { status: 'Sent', verificationUrl: LINK, history: [] } }],
            },
            'companies/c1/leads/lead1/activity_logs/l4': {
                action: 'PEV_REQUEST', details: `Initiated Manual verification for X (Sent to: Manual Download) | Portal: ${LINK}`,
            },
            // A verification that never stored a link, and a record with no employers.
            'companies/c1/applications/a2': { employers: [{ employerId: 'emp_4', verification: { status: 'Completed', history: [SENT] } }] },
            'companies/c1/applications/a3': { firstName: 'Cy' },
        },
    });
}

describe('data cleanup — PEV links', () => {
    beforeEach(seed);

    it('counts without writing', async () => {
        const result = await check();
        expect(result).toMatchObject({ done: true, counts: { records: 2, activityLogs: 2 }, total: 4 });
        expect(world.writes).toBe(0);
    });

    it('removes the token and link and nothing else', async () => {
        await run();
        expect(world.doc('companies/c1/applications/a1')).toEqual({
            firstName: 'Ada',
            employers: [
                {
                    employerId: 'emp_1',
                    companyName: 'Old Freight',
                    verification: { status: 'Sent', method: 'Manual', history: [SENT, { action: 'Reminder sent' }] },
                },
                { employerId: 'emp_2', companyName: 'No Request Yet' },
            ],
        });
        expect(world.doc('companies/c1/leads/lead1').employers[0].verification).toEqual({ status: 'Sent', history: [] });
        expect(world.doc('companies/c1/applications/a1/activity_logs/l1').details)
            .toBe('Initiated Manual verification for Old Freight (Sent to: Manual Download)');
        expect(world.doc('companies/c1/applications/a1/activity_logs/l3').details).toBe(`Called | Portal: ${LINK}`);
        expect(world.doc('companies/c1/leads/lead1/activity_logs/l4').details)
            .toBe('Initiated Manual verification for X (Sent to: Manual Download)');
        expect(world.writes).toBe(4);
    });

    it('changes nothing on a second run', async () => {
        await run();
        world.writes = 0;
        expect((await run()).total).toBe(0);
        expect(world.writes).toBe(0);
    });

    it('stops at the time budget without writing', async () => {
        const result = await __private.execute({ item: 'pevLinks', mode: 'run', outOfTime: () => true });
        expect(result.done).toBe(false);
        expect(world.writes).toBe(0);
    });
});
