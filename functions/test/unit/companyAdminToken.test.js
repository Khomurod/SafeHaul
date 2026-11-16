/**
 * The one company-admin-by-token check (`shared/companyAdminToken.js`) that
 * Manage Team (`listCompanyTeam`), Add User (`createPortalUser`) and Remove User
 * (`deletePortalUser`) share. Its rule is the one each of them wrote by hand:
 * a super admin by token, or `roles[companyId] === 'company_admin'` in the
 * token; a deactivated company's admin is refused, a super admin never is.
 * All ids are artificial.
 */
jest.mock('firebase-functions/v2/https', () => ({
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));

const mockAssertCompanyActive = jest.fn();
jest.mock('../../shared/companyAccess', () => ({
    assertCompanyActive: (...args) => mockAssertCompanyActive(...args),
}));

const { assertCompanyAdminByToken } = require('../../shared/companyAdminToken');

const auth = (token) => ({ uid: 'u1', token });
const deactivated = () => Object.assign(new Error('This company has been deactivated.'), { code: 'permission-denied' });

beforeEach(() => {
    mockAssertCompanyActive.mockReset();
    mockAssertCompanyActive.mockResolvedValue(undefined);
});

describe('assertCompanyAdminByToken', () => {
    it('lets a super admin through, by either claim, with or without a company, and never reads the company', async () => {
        await expect(assertCompanyAdminByToken(auth({ globalRole: 'super_admin' }), 'co-1')).resolves.toEqual({ isSuperAdmin: true });
        await expect(assertCompanyAdminByToken(auth({ roles: { globalRole: 'super_admin' } }), undefined)).resolves.toEqual({ isSuperAdmin: true });
        expect(mockAssertCompanyActive).not.toHaveBeenCalled();
    });

    it("lets the company's admin through once the company is checked active", async () => {
        await expect(assertCompanyAdminByToken(auth({ roles: { 'co-1': 'company_admin' } }), 'co-1')).resolves.toEqual({ isSuperAdmin: false });
        expect(mockAssertCompanyActive).toHaveBeenCalledWith('co-1');
    });

    it("refuses a deactivated company's admin", async () => {
        mockAssertCompanyActive.mockRejectedValue(deactivated());
        await expect(assertCompanyAdminByToken(auth({ roles: { 'co-1': 'company_admin' } }), 'co-1'))
            .rejects.toMatchObject({ code: 'permission-denied', message: 'This company has been deactivated.' });
    });

    it.each([
        ['an hr user', { roles: { 'co-1': 'hr_user' } }, 'co-1'],
        ['a recruiter', { roles: { 'co-1': 'recruiter' } }, 'co-1'],
        ["another company's admin", { roles: { 'co-2': 'company_admin' } }, 'co-1'],
        ['a legacy `admin` role (not in this rule)', { roles: { 'co-1': 'admin' } }, 'co-1'],
        ['a company admin naming no company', { roles: { 'co-1': 'company_admin' } }, undefined],
        ['no roles at all', {}, 'co-1'],
    ])('refuses %s with the callable\'s message, before reading the company', async (_who, token, companyId) => {
        await expect(assertCompanyAdminByToken(auth(token), companyId, 'You do not have permission to add users to this company.'))
            .rejects.toMatchObject({ code: 'permission-denied', message: 'You do not have permission to add users to this company.' });
        expect(mockAssertCompanyActive).not.toHaveBeenCalled();
    });

    it('refuses with "Permission denied." by default, and a caller who is not signed in', async () => {
        await expect(assertCompanyAdminByToken(auth({}), 'co-1')).rejects.toMatchObject({ code: 'permission-denied', message: 'Permission denied.' });
        await expect(assertCompanyAdminByToken(undefined, 'co-1')).rejects.toMatchObject({ code: 'unauthenticated' });
    });
});
