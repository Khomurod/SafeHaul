/**
 * Data cleanup → test accounts: what the removed Deep Diagnostic left. Only
 * records with the diagnostic's exact shapes go, the login first; a look-alike
 * that is not marked as a test record, a Super Admin and the caller stay.
 *
 * Every account, company and file below is artificial.
 */
jest.mock('firebase-functions/v2/https', () => require('./dataCleanup.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./dataCleanup.support').world.firebaseAdmin);

const { world, request } = require('./dataCleanup.support');
const { dataCleanup, __private } = require('../../maintenance/dataCleanup');

const check = () => dataCleanup(request({ mode: 'check', item: 'testAccounts' }));
const run = () => dataCleanup(request({ mode: 'run', item: 'testAccounts' }));

const A = 'SYS_TEST_1700000000001';
const B = 'SYS_TEST_B_1700000000001';
const DRIVER = 'SYS_DRIVER_1700000000001';

function seed() {
    world.reset({
        users: [
            { uid: 'test-uid', email: 'systest_1700000000001@example.com' },
            { uid: 'real-uid', email: 'dispatch@carrier.test' },
            { uid: 'real-2-uid', email: 'ops@carrier.test' },
            { uid: 'near-uid', email: 'systest_1700000000002@example.com.au' },
            { uid: 'named-uid', email: 'systest_admin@example.com' },
            { uid: 'super-uid', email: 'systest_1700000000003@example.com', customClaims: { globalRole: 'super_admin' } },
        ],
        firestore: {
            'users/test-uid': { email: 'systest_1700000000001@example.com', fullName: 'System Test User' },
            'users/gone-uid': { email: 'systest_1600000000000@example.com' },
            'users/real-uid': { email: 'dispatch@carrier.test' },
            // A test address on the record of a login that is not a test login: left.
            'users/super-uid': { email: 'systest_1700000000003@example.com' },
            'users/real-2-uid': { email: 'systest_1700000000004@example.com' },
            'users/named-uid': { email: 'systest_admin@example.com' },
            'memberships/m-test': { userId: 'test-uid', companyId: A, role: 'hr_user' },
            'memberships/TEMP_MEM_1700000000001': { userId: 'test-uid', companyId: B, role: 'company_admin', isTestRecord: true },
            'memberships/m-gone': { userId: 'gone-uid', companyId: 'carrier-one' },
            'memberships/m-real': { userId: 'real-uid', companyId: 'carrier-one', role: 'company_admin' },
            'memberships/m-real-flagged': { userId: 'real-uid', companyId: 'carrier-one', isTestRecord: true },
            // A real user's membership in the look-alike company below: left with it.
            'memberships/m-lookalike': { userId: 'real-uid', companyId: 'SYS_TEST_1680000000000' },
            [`companies/${A}`]: { companyName: 'Test Company A', isTestRecord: true },
            [`companies/${A}/applications/${DRIVER}`]: { applicantName: 'Test Driver', isTestRecord: true },
            [`companies/${A}/applications/${DRIVER}/activities/act-1`]: { type: 'note' },
            [`companies/${A}/leads/lead-1`]: { name: 'Standard Company Lead', isTestRecord: true },
            [`companies/${B}`]: { companyName: 'Test Company B', isTestRecord: true },
            // A company whose document the diagnostic deleted, its records left behind.
            'companies/SYS_TEST_1690000000000/internal_stats/dashboard': { leadsTotal: 1 },
            // Named like a test company, not marked as one: left.
            'companies/SYS_TEST_1680000000000': { companyName: 'Look-alike Carrier' },
            'companies/SYS_TEST_EXTRA': { companyName: 'Other shape', isTestRecord: true },
            'companies/carrier-one': { companyName: 'Carrier One' },
            [`drivers/${DRIVER}`]: { personalInfo: { firstName: 'Test' }, isTestRecord: true },
            'drivers/SYS_DRIVER_1680000000000': { personalInfo: { firstName: 'Unmarked' } },
            'drivers/driver-real': { personalInfo: { firstName: 'Real' } },
            [`public_profiles/${A}`]: { companyName: 'Test Company A' },
            'public_profiles/SYS_TEST_1680000000000': { companyName: 'Look-alike Carrier' },
            'public_profiles/carrier-one': { companyName: 'Carrier One' },
        },
        storage: [
            'system_health_tests/SYS_TEST_1700000000001.txt',
            'system_health_tests/SYS_TEST_notes.pdf',
            `companies/${A}/applications/${DRIVER}/cdl_front.txt`,
            'companies/SYS_TEST_1680000000000/logo.png',
            'companies/carrier-one/logo.png',
        ],
    });
}

const EXPECTED = {
    logins: 1, memberships: 3, userDocs: 2, companies: 3, drivers: 1, publicProfiles: 1, files: 2, skipped: 6,
};

describe('data cleanup — test accounts', () => {
    beforeEach(seed);

    it('counts without writing', async () => {
        const result = await check();
        expect(result).toMatchObject({ item: 'testAccounts', mode: 'check', done: true, counts: EXPECTED, total: 13 });
        expect(world.writes).toBe(0);
        expect(world.authUsers.has('test-uid')).toBe(true);
    });

    it('deletes exactly the diagnostic records, the login first', async () => {
        const result = await run();
        expect(result).toMatchObject({ done: true, counts: EXPECTED });

        expect([...world.authUsers.keys()].sort()).toEqual(['named-uid', 'near-uid', 'real-2-uid', 'real-uid', 'super-uid']);
        expect([...world.docs.keys()].sort()).toEqual([
            'companies/SYS_TEST_1680000000000',
            'companies/SYS_TEST_EXTRA',
            'companies/carrier-one',
            'drivers/SYS_DRIVER_1680000000000',
            'drivers/driver-real',
            'memberships/m-lookalike',
            'memberships/m-real',
            'memberships/m-real-flagged',
            'public_profiles/SYS_TEST_1680000000000',
            'public_profiles/carrier-one',
            'users/named-uid',
            'users/real-2-uid',
            'users/real-uid',
            'users/super-uid',
        ]);
        expect([...world.files].sort()).toEqual([
            'companies/SYS_TEST_1680000000000/logo.png',
            'companies/carrier-one/logo.png',
            'system_health_tests/SYS_TEST_notes.pdf',
        ]);
        // The login goes before anything its membership trigger could rebuild.
        expect(world.log[0]).toBe('deleteUser test-uid');
        const firstMembership = world.log.findIndex((line) => line.startsWith('delete memberships/'));
        const firstUserDoc = world.log.findIndex((line) => line.startsWith('delete users/'));
        const firstCompany = world.log.findIndex((line) => line.startsWith('delete companies/'));
        expect(firstMembership).toBeLessThan(firstUserDoc);
        expect(firstUserDoc).toBeLessThan(firstCompany);
    });

    it('changes nothing on a second run', async () => {
        await run();
        world.writes = 0;
        const again = await run();
        expect(again.total).toBe(0);
        expect(again.counts.skipped).toBe(6);
        expect(world.writes).toBe(0);
    });

    it('never deletes the caller, even with a test address', async () => {
        world.authUsers.set('owner-uid', { uid: 'owner-uid', email: 'systest_1700000000009@example.com' });
        await run();
        expect(world.authUsers.has('owner-uid')).toBe(true);
    });

    it('stops at the time budget without writing, and says it is not done', async () => {
        const result = await __private.execute({ item: 'testAccounts', mode: 'run', outOfTime: () => true });
        expect(result.done).toBe(false);
        expect(world.writes).toBe(0);
    });
});
