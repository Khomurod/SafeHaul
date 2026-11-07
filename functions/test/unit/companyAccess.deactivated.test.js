/**
 * A deactivated company's staff are refused by the server's access checks; a
 * super admin never is.
 *
 * Super Admin → Companies writes `isActive: false` on the company, and the
 * intake already refused that company's applications (companyTenant.js). The
 * staff checks never read it: a company admin, recruiter or owner of a
 * deactivated company kept every server action. All ids are artificial.
 *
 * The company is read while the caller's claims load, once per check and never
 * kept between checks, and the check hands back what it read so a callable need
 * not read it again.
 */
const mockClaims = new Map();
const mockDocs = new Map();
const mockMemberships = [];
const mockReads = [];
const mockFailingReads = new Map();
const mockEvents = [];
const mockClaimsGate = { wait: null };
jest.mock('../../firebaseAdmin', () => {
    const ref = (path) => ({
        get: async () => {
            mockReads.push(path);
            mockEvents.push(`read ${path}`);
            if (mockFailingReads.has(path)) throw mockFailingReads.get(path);
            const data = mockDocs.get(path);
            return { exists: data !== undefined, data: () => data };
        },
        collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
    });
    const membershipQuery = (filters) => ({
        where: (field, _op, value) => membershipQuery({ ...filters, [field]: value }),
        limit: () => membershipQuery(filters),
        get: async () => {
            const docs = mockMemberships
                .filter((m) => Object.entries(filters).every(([field, value]) => m[field] === value))
                .map((m) => ({ data: () => m }));
            return { empty: docs.length === 0, docs };
        },
    });
    // As Firestore does, a path that is not a document is refused on the spot.
    const topLevelDoc = (name) => (id) => {
        if (typeof id !== 'string' || id.includes('/')) throw new Error('Value for argument "documentPath" is not a valid resource path.');
        return ref(`${name}/${id}`);
    };
    const db = {
        collection: (name) => (name === 'memberships'
            ? membershipQuery({})
            : { doc: topLevelDoc(name) }),
    };
    const getUser = async (uid) => {
        mockEvents.push(`getUser ${uid}`);
        if (mockClaimsGate.wait) await mockClaimsGate.wait;
        mockEvents.push(`claims ${uid}`);
        return { customClaims: mockClaims.get(uid) || {} };
    };
    return { db, admin: { auth: () => ({ getUser }) } };
});

const {
    assertCompanyAccess,
    assertCompanyAdminStrict,
    assertCompanyAccessForRequest,
    assertCompanyActive,
} = require('../../shared/companyAccess');

const DEACTIVATED = /deactivated/i;
const OFF = { companyName: 'Off Freight', isActive: false, ownerId: 'owner-1' };
const ON = { companyName: 'On Freight', isActive: true };
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Holds every getUser until the returned function is called. */
function holdClaims() {
    let release;
    mockClaimsGate.wait = new Promise((resolve) => {
        release = resolve;
    });
    return release;
}

beforeEach(() => {
    mockClaims.clear();
    mockDocs.clear();
    mockMemberships.length = 0;
    mockReads.length = 0;
    mockFailingReads.clear();
    mockEvents.length = 0;
    mockClaimsGate.wait = null;
    mockDocs.set('companies/co-off', OFF);
    mockDocs.set('companies/co-on', ON);
    mockDocs.set('companies/co-old', { companyName: 'Old Freight' }); // created before the field existed
    mockDocs.set('companies/co-off/team/hr-1', { role: 'hr_user' });
    mockClaims.set('admin-1', { roles: { 'co-off': 'company_admin', 'co-on': 'company_admin', 'co-old': 'company_admin' } });
    mockClaims.set('super-1', { roles: { globalRole: 'super_admin' } });
    mockMemberships.push({ userId: 'recruiter-1', companyId: 'co-off', role: 'recruiter' });
    mockMemberships.push({ userId: 'recruiter-2', companyId: 'co-on', role: 'recruiter' });
});

describe('a deactivated company', () => {
    it("refuses its admin's access and admin checks", async () => {
        await expect(assertCompanyAccess('admin-1', 'co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
        await expect(assertCompanyAdminStrict('admin-1', 'co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
    });

    it('refuses a recruiter known by membership, a team member, and the owner', async () => {
        await expect(assertCompanyAccess('recruiter-1', 'co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
        await expect(assertCompanyAccess('hr-1', 'co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
        await expect(assertCompanyAccess('owner-1', 'co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
        await expect(assertCompanyAdminStrict('owner-1', 'co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
    });

    it('keeps the refusal a permission denial through the request wrapper', async () => {
        await expect(assertCompanyAccessForRequest({ auth: { uid: 'admin-1' } }, 'co-off'))
            .rejects.toMatchObject({ code: 'permission-denied', message: 'This company has been deactivated.' });
        await expect(assertCompanyAccessForRequest({ auth: { uid: 'hr-1' } }, 'co-off'))
            .rejects.toMatchObject({ code: 'permission-denied', message: 'This company has been deactivated.' });
    });

    it('is refused to callables that check the role themselves', async () => {
        await expect(assertCompanyActive('co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
        await expect(assertCompanyActive('co-on')).resolves.toBeUndefined();
    });

    it('never refuses a super admin', async () => {
        const access = await assertCompanyAccess('super-1', 'co-off');
        const admin = await assertCompanyAdminStrict('super-1', 'co-off');
        const wrapped = await assertCompanyAccessForRequest({ auth: { uid: 'super-1' } }, 'co-off');
        for (const snap of [access, admin, wrapped]) expect(snap.data()).toEqual(OFF);
    });
});

describe('a super admin', () => {
    it('passes when the company cannot be read, and is handed nothing', async () => {
        mockFailingReads.set('companies/co-off', Object.assign(new Error('unavailable'), { code: 'unavailable' }));
        await expect(assertCompanyAccess('super-1', 'co-off')).resolves.toBeUndefined();
        await expect(assertCompanyAdminStrict('super-1', 'co-off')).resolves.toBeUndefined();
        await expect(assertCompanyAccessForRequest({ auth: { uid: 'super-1' } }, 'co-off')).resolves.toBeUndefined();
    });

    it('passes for a company id the database refuses outright, as before the read was started early', async () => {
        await expect(assertCompanyAccess('super-1', 'co/off')).resolves.toBeUndefined();
        await expect(assertCompanyAdminStrict('super-1', 'co/off')).resolves.toBeUndefined();
    });
});

describe('an active company', () => {
    it('lets its staff through, with or without the field', async () => {
        await expect(assertCompanyAccess('admin-1', 'co-on')).resolves.toBeDefined();
        await expect(assertCompanyAdminStrict('admin-1', 'co-on')).resolves.toBeDefined();
        await expect(assertCompanyAccess('admin-1', 'co-old')).resolves.toBeDefined();
        await expect(assertCompanyAdminStrict('admin-1', 'co-old')).resolves.toBeDefined();
    });

    it('still refuses someone with no role there', async () => {
        await expect(assertCompanyAccess('recruiter-1', 'co-on')).rejects.toMatchObject({ code: 'permission-denied', message: 'You do not have access to this company.' });
        await expect(assertCompanyAdminStrict('recruiter-2', 'co-on')).rejects.toMatchObject({ code: 'permission-denied', message: 'Company admin access required.' });
    });

    it('hands back the company it read, by claims and by membership', async () => {
        expect((await assertCompanyAccess('admin-1', 'co-on')).data()).toEqual(ON);
        expect((await assertCompanyAdminStrict('admin-1', 'co-on')).data()).toEqual(ON);
        expect((await assertCompanyAccessForRequest({ auth: { uid: 'admin-1' } }, 'co-on')).data()).toEqual(ON);
        expect((await assertCompanyAccess('recruiter-2', 'co-on')).data()).toEqual(ON);
        expect((await assertCompanyAccessForRequest({ auth: { uid: 'recruiter-2' } }, 'co-on')).data()).toEqual(ON);
    });

    it('hands back a missing company as not existing, so the callable can say so', async () => {
        mockClaims.set('admin-1', { roles: { 'co-gone': 'company_admin' } });
        expect((await assertCompanyAccess('admin-1', 'co-gone')).exists).toBe(false);
        expect((await assertCompanyAdminStrict('admin-1', 'co-gone')).exists).toBe(false);
    });
});

describe('one round trip', () => {
    it.each([
        ['assertCompanyAccess', () => assertCompanyAccess('admin-1', 'co-on')],
        ['assertCompanyAdminStrict', () => assertCompanyAdminStrict('admin-1', 'co-on')],
        ['assertCompanyAccessForRequest', () => assertCompanyAccessForRequest({ auth: { uid: 'admin-1' } }, 'co-on')],
    ])('%s reads the company while the claims load', async (_name, check) => {
        const release = holdClaims();
        const pending = check();
        await settle();
        expect(mockEvents).toEqual(['read companies/co-on', 'getUser admin-1']);
        release();
        expect((await pending).data()).toEqual(ON);
        expect(mockReads).toEqual(['companies/co-on']);
    });

    it('reads the company once when the claims name no role and membership decides', async () => {
        await assertCompanyAccess('recruiter-2', 'co-on');
        expect(mockReads.filter((path) => path === 'companies/co-on')).toHaveLength(1);
        await expect(assertCompanyAccess('hr-1', 'co-off')).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockReads.filter((path) => path === 'companies/co-off')).toHaveLength(1);
    });

    it('reads the company again on every check: a deactivation applies to the very next call', async () => {
        expect((await assertCompanyAccess('admin-1', 'co-on')).data()).toEqual(ON);
        mockDocs.set('companies/co-on', { ...ON, isActive: false });
        await expect(assertCompanyAccess('admin-1', 'co-on')).rejects.toMatchObject({ code: 'permission-denied', message: 'This company has been deactivated.' });
        mockClaims.set('admin-1', {});
        mockDocs.set('companies/co-on', ON);
        await expect(assertCompanyAccess('admin-1', 'co-on')).rejects.toMatchObject({ code: 'permission-denied', message: 'You do not have access to this company.' });
        expect(mockReads.filter((path) => path === 'companies/co-on')).toHaveLength(3);
    });
});

describe('a company read that fails', () => {
    beforeEach(() => {
        mockFailingReads.set('companies/co-on', Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    });

    it('fails the check of anyone but a super admin, as it did when read after the claims', async () => {
        await expect(assertCompanyAccess('admin-1', 'co-on')).rejects.toMatchObject({ code: 'unavailable' });
        await expect(assertCompanyAdminStrict('admin-1', 'co-on')).rejects.toMatchObject({ code: 'unavailable' });
        await expect(assertCompanyAccess('recruiter-2', 'co-on')).rejects.toMatchObject({ code: 'unavailable' });
        await expect(assertCompanyAccessForRequest({ auth: { uid: 'admin-1' } }, 'co-on'))
            .rejects.toMatchObject({ code: 'internal', message: 'Unable to verify company access.' });
    });

    // Jest fails the test on its own when a rejection goes unhandled, even one
    // handled a tick later.
    it('is never an unhandled rejection while the claims are still loading', async () => {
        const release = holdClaims();
        const checks = [
            assertCompanyAccess('admin-1', 'co-on'),
            assertCompanyAdminStrict('admin-1', 'co-on'),
            assertCompanyAccess('super-1', 'co-on'),
            assertCompanyAdminStrict('super-1', 'co-on'),
        ].map((check) => check.then(() => 'passed', (error) => error.code));
        await settle();
        await settle();
        release();
        expect(await Promise.all(checks)).toEqual(['unavailable', 'unavailable', 'passed', 'passed']);
    });
});

describe('a refusal before anything is read', () => {
    it('keeps its code and message, and reads nothing', async () => {
        await expect(assertCompanyAccess('', 'co-on')).rejects.toMatchObject({ code: 'unauthenticated', message: 'Login required.' });
        await expect(assertCompanyAccess('admin-1', '')).rejects.toMatchObject({ code: 'invalid-argument', message: 'companyId is required.' });
        await expect(assertCompanyAdminStrict('', 'co-on')).rejects.toMatchObject({ code: 'unauthenticated', message: 'Login required.' });
        await expect(assertCompanyAdminStrict('admin-1', undefined)).rejects.toMatchObject({ code: 'invalid-argument', message: 'companyId is required.' });
        await expect(assertCompanyAccessForRequest({}, 'co-on')).rejects.toMatchObject({ code: 'unauthenticated', message: 'Login required.' });
        expect(mockEvents).toEqual([]);
    });
});
