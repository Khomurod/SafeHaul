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
const mockUserGet = jest.fn().mockResolvedValue({ exists: false });
const mockMembershipAdd = jest.fn().mockResolvedValue({ id: 'mem1' });
const mockMembershipGet = jest.fn().mockResolvedValue({ empty: true });

jest.mock('../../firebaseAdmin', () => ({
  admin: { firestore: { FieldValue: { serverTimestamp: () => '__ts' } } },
  db: {
    collection: (name) => {
      if (name === 'users') {
        return {
          doc: () => ({
            set: (...a) => mockUserSet(...a),
            get: (...a) => mockUserGet(...a),
          }),
        };
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
    mockUserGet.mockResolvedValue({ exists: false });
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

// THE ROOT CAUSE of "Unknown / No Email": adding an email that ALREADY had a
// Firebase Auth account created the membership but never a `users/{uid}` profile,
// so the team roster had no name or email to render for a valid member.
describe('createPortalUser mirrors a profile for pre-existing Auth accounts', () => {
  const existingAuthUser = { uid: 'existing-user', displayName: 'Auth Name', email: 'existing@x.com' };
  const addExisting = (data = {}) => createPortalUser(req({ co1: 'company_admin' }, {
    fullName: 'Typed Name', email: 'existing@x.com', companyId: 'co1', role: 'recruiter', ...data,
  }));

  beforeEach(() => {
    jest.clearAllMocks();
    mockMembershipGet.mockResolvedValue({ empty: true });
    mockGetUserByEmail.mockResolvedValue(existingAuthUser);
    mockUserGet.mockResolvedValue({ exists: false });
  });

  it('creates the missing profile from the typed name and the Auth email', async () => {
    const res = await addExisting();
    expect(res.status).toBe('success');
    expect(mockCreateUser).not.toHaveBeenCalled();

    expect(mockUserSet).toHaveBeenCalledTimes(1);
    const [payload, opts] = mockUserSet.mock.calls[0];
    expect(payload).toMatchObject({ name: 'Typed Name', email: 'existing@x.com', createdAt: '__ts' });
    expect(opts).toEqual({ merge: true });

    // The membership is still created — the point of the call.
    expect(mockMembershipAdd).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'existing-user', companyId: 'co1', role: 'recruiter',
    }));
  });

  it('falls back to the Auth displayName when the admin typed no name', async () => {
    await addExisting({ fullName: '   ' });
    expect(mockUserSet.mock.calls[0][0]).toMatchObject({ name: 'Auth Name', email: 'existing@x.com' });
  });

  it('never overwrites a name the profile already stores', async () => {
    mockUserGet.mockResolvedValue({ exists: true, data: () => ({ name: 'Corrected Name', email: 'existing@x.com' }) });
    await addExisting();
    expect(mockUserSet).not.toHaveBeenCalled();
  });

  it('fills in only the missing half of an incomplete profile', async () => {
    // A profile created by onMembershipWrite's companyIds merge carries no identity.
    mockUserGet.mockResolvedValue({ exists: true, data: () => ({ companyIds: ['co1'] }) });
    await addExisting();
    const [payload] = mockUserSet.mock.calls[0];
    expect(payload).toEqual({ name: 'Typed Name', email: 'existing@x.com' });
    // Existing document -> no createdAt backdating.
    expect(payload.createdAt).toBeUndefined();
  });

  it('still adds the user to the company when the profile write fails', async () => {
    mockUserSet.mockRejectedValueOnce(new Error('firestore unavailable'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await addExisting();
    expect(res.status).toBe('success');
    expect(mockMembershipAdd).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('does not duplicate an existing membership but still repairs the profile', async () => {
    mockMembershipGet.mockResolvedValue({ empty: false });
    const res = await addExisting();
    expect(res.message).toBe('User is already in this company.');
    expect(mockUserSet).toHaveBeenCalledTimes(1);
    expect(mockMembershipAdd).not.toHaveBeenCalled();
  });
});
