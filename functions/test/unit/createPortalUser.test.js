jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: jest.fn(() => () => {}) }));

const mockGetUserByEmail = jest.fn();
const mockCreateUser = jest.fn();
const mockUserSet = jest.fn().mockResolvedValue();
const mockMembershipAdd = jest.fn().mockResolvedValue({ id: 'mem1' });
const mockMembershipGet = jest.fn().mockResolvedValue({ empty: true });

jest.mock('../../firebaseAdmin', () => ({
  admin: { firestore: { FieldValue: { serverTimestamp: () => '__ts' } } },
  db: {
    collection: (name) => {
      if (name === 'users') {
        return { doc: () => ({ set: (...a) => mockUserSet(...a) }) };
      }
      // memberships
      return {
        where: () => ({ where: () => ({ get: (...a) => mockMembershipGet(...a) }) }),
        add: (...a) => mockMembershipAdd(...a),
      };
    },
  },
  auth: {
    getUserByEmail: (...a) => mockGetUserByEmail(...a),
    createUser: (...a) => mockCreateUser(...a),
  },
}));

const { createPortalUser } = require('../../hrAdmin');

// Build a callable request with the given claims + payload.
const req = (roles, data) => ({ auth: { uid: 'caller', token: { roles } }, data });

describe('createPortalUser authorization (default-deny)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMembershipGet.mockResolvedValue({ empty: true });
    // Default: email not found -> create a fresh user.
    const notFound = new Error('nf'); notFound.code = 'auth/user-not-found';
    mockGetUserByEmail.mockRejectedValue(notFound);
    mockCreateUser.mockResolvedValue({ uid: 'new-user' });
  });

  it('rejects unauthenticated callers', async () => {
    await expect(createPortalUser({ data: { email: 'a@b.com', companyId: 'co1', role: 'hr_user' } }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects missing email/companyId/role', async () => {
    await expect(createPortalUser(req({ co1: 'company_admin' }, { companyId: 'co1', role: 'hr_user' })))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  // THE REGRESSION: a non-super role that isn't admin/hr used to skip every
  // permission check and create a cross-tenant membership.
  it('blocks a non-admin from creating a recruiter in an arbitrary company', async () => {
    await expect(
      createPortalUser(req({ co1: 'recruiter' }, { email: 'evil@x.com', password: 'x', companyId: 'victim-co', role: 'recruiter' })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockMembershipAdd).not.toHaveBeenCalled();
  });

  it('blocks a recruiter-role caller from escalating in their OWN company too', async () => {
    // Only a company_admin (or super admin) may add users; a recruiter cannot.
    await expect(
      createPortalUser(req({ co1: 'recruiter' }, { email: 'x@x.com', password: 'x', companyId: 'co1', role: 'recruiter' })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockMembershipAdd).not.toHaveBeenCalled();
  });

  it('rejects an unknown/unsupported role outright', async () => {
    await expect(
      createPortalUser(req({ co1: 'company_admin' }, { email: 'x@x.com', password: 'x', companyId: 'co1', role: 'owner' })),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockMembershipAdd).not.toHaveBeenCalled();
  });

  it('blocks a non-super-admin from creating a super_admin', async () => {
    await expect(
      createPortalUser(req({ co1: 'company_admin' }, { email: 'x@x.com', password: 'x', companyId: 'co1', role: 'super_admin' })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockMembershipAdd).not.toHaveBeenCalled();
  });

  it('blocks a company_admin of company A from adding users to company B', async () => {
    await expect(
      createPortalUser(req({ 'co-a': 'company_admin' }, { email: 'x@x.com', password: 'x', companyId: 'co-b', role: 'hr_user' })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockMembershipAdd).not.toHaveBeenCalled();
  });

  it('allows a company_admin to add a recruiter to their own company', async () => {
    const res = await createPortalUser(
      req({ co1: 'company_admin' }, { fullName: 'Rec', email: 'rec@x.com', password: 'pw', companyId: 'co1', role: 'recruiter' }),
    );
    expect(res.status).toBe('success');
    expect(mockMembershipAdd).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'new-user', companyId: 'co1', role: 'recruiter',
    }));
  });

  it('allows a global super_admin to create another super_admin', async () => {
    const res = await createPortalUser(
      req({ globalRole: 'super_admin' }, { fullName: 'Boss', email: 'boss@x.com', password: 'pw', companyId: 'co1', role: 'super_admin' }),
    );
    expect(res.status).toBe('success');
    expect(mockMembershipAdd).toHaveBeenCalledWith(expect.objectContaining({ role: 'super_admin' }));
  });
});
