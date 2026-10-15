jest.mock('firebase-functions/v2/https', () => ({
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));

const { isSuperAdminClaims, assertSuperAdminAuth } = require('../../shared/superAdmin');

describe('isSuperAdminClaims', () => {
  it('reads the role under `roles` and at the token root, as the rules do', () => {
    expect(isSuperAdminClaims({ roles: { globalRole: 'super_admin' } })).toBe(true);
    expect(isSuperAdminClaims({ globalRole: 'super_admin' })).toBe(true);
    expect(isSuperAdminClaims({ globalRole: 'super_admin', roles: { 'co-1': 'company_admin' } })).toBe(true);
  });

  it('refuses every other role and shape', () => {
    expect(isSuperAdminClaims({ roles: { 'co-1': 'company_admin' } })).toBe(false);
    expect(isSuperAdminClaims({ roles: { globalRole: 'company_admin' } })).toBe(false);
    expect(isSuperAdminClaims({ super_admin: true })).toBe(false);
    expect(isSuperAdminClaims({})).toBe(false);
    expect(isSuperAdminClaims(null)).toBe(false);
    expect(isSuperAdminClaims(undefined)).toBe(false);
  });
});

describe('assertSuperAdminAuth', () => {
  it('refuses a caller who is not signed in', () => {
    expect(() => assertSuperAdminAuth(undefined)).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
  });

  it("refuses a signed-in caller who is not a super admin, with the callable's message", () => {
    const auth = { uid: 'u1', token: { roles: { 'co-1': 'company_admin' } } };
    expect(() => assertSuperAdminAuth(auth, 'Only Super Admins can delete companies.'))
      .toThrow(expect.objectContaining({ code: 'permission-denied', message: 'Only Super Admins can delete companies.' }));
    expect(() => assertSuperAdminAuth(auth))
      .toThrow(expect.objectContaining({ code: 'permission-denied', message: 'Super Admin access is required.' }));
  });

  it('returns the auth of a super admin', () => {
    const auth = { uid: 'u1', token: { roles: { globalRole: 'super_admin' } } };
    expect(assertSuperAdminAuth(auth)).toBe(auth);
  });
});
