/**
 * A deactivated company's staff are refused by the server's access checks; a
 * super admin never is.
 *
 * Super Admin → Companies writes `isActive: false` on the company, and the
 * intake already refused that company's applications (companyTenant.js). The
 * staff checks never read it: a company admin, recruiter or owner of a
 * deactivated company kept every server action. All ids are artificial.
 */
const mockClaims = new Map();
const mockDocs = new Map();
const mockMemberships = [];
const mockReads = [];
jest.mock('../../firebaseAdmin', () => {
    const ref = (path) => ({
        get: async () => {
            mockReads.push(path);
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
    const db = {
        collection: (name) => (name === 'memberships'
            ? membershipQuery({})
            : { doc: (id) => ref(`${name}/${id}`) }),
    };
    return {
        db,
        admin: { auth: () => ({ getUser: async (uid) => ({ customClaims: mockClaims.get(uid) || {} }) }) },
    };
});

const {
    assertCompanyAccess,
    assertCompanyAdminStrict,
    assertCompanyAccessForRequest,
    assertCompanyActive,
} = require('../../shared/companyAccess');

const DEACTIVATED = /deactivated/i;

beforeEach(() => {
    mockClaims.clear();
    mockDocs.clear();
    mockMemberships.length = 0;
    mockReads.length = 0;
    mockDocs.set('companies/co-off', { companyName: 'Off Freight', isActive: false, ownerId: 'owner-1' });
    mockDocs.set('companies/co-on', { companyName: 'On Freight', isActive: true });
    mockDocs.set('companies/co-old', { companyName: 'Old Freight' }); // created before the field existed
    mockClaims.set('admin-1', { roles: { 'co-off': 'company_admin', 'co-on': 'company_admin', 'co-old': 'company_admin' } });
    mockClaims.set('super-1', { roles: { globalRole: 'super_admin' } });
    mockMemberships.push({ userId: 'recruiter-1', companyId: 'co-off', role: 'recruiter' });
});

describe('a deactivated company', () => {
    it("refuses its admin's access and admin checks", async () => {
        await expect(assertCompanyAccess('admin-1', 'co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
        await expect(assertCompanyAdminStrict('admin-1', 'co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
    });

    it('refuses a recruiter known by membership, and the owner', async () => {
        await expect(assertCompanyAccess('recruiter-1', 'co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
        await expect(assertCompanyAccess('owner-1', 'co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
        await expect(assertCompanyAdminStrict('owner-1', 'co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
    });

    it('keeps the refusal a permission denial through the request wrapper', async () => {
        await expect(assertCompanyAccessForRequest({ auth: { uid: 'admin-1' } }, 'co-off'))
            .rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
    });

    it('is refused to callables that check the role themselves', async () => {
        await expect(assertCompanyActive('co-off')).rejects.toMatchObject({ code: 'permission-denied', message: expect.stringMatching(DEACTIVATED) });
        await expect(assertCompanyActive('co-on')).resolves.toBeUndefined();
    });

    it('never refuses a super admin, and is not even read for one', async () => {
        await expect(assertCompanyAccess('super-1', 'co-off')).resolves.toBeUndefined();
        await expect(assertCompanyAdminStrict('super-1', 'co-off')).resolves.toBeUndefined();
        expect(mockReads).toEqual([]);
    });
});

describe('an active company', () => {
    it('lets its staff through, with or without the field', async () => {
        await expect(assertCompanyAccess('admin-1', 'co-on')).resolves.toBeUndefined();
        await expect(assertCompanyAdminStrict('admin-1', 'co-on')).resolves.toBeUndefined();
        await expect(assertCompanyAccess('admin-1', 'co-old')).resolves.toBeUndefined();
        await expect(assertCompanyAdminStrict('admin-1', 'co-old')).resolves.toBeUndefined();
    });

    it('still refuses someone with no role there', async () => {
        await expect(assertCompanyAccess('recruiter-1', 'co-on')).rejects.toMatchObject({ code: 'permission-denied', message: 'You do not have access to this company.' });
    });
});
