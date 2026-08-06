jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: jest.fn(() => () => {}) }));

// Artificial companies, uids, names and emails only.
const state = {
  memberships: [],      // [{ id, userId, companyId, role }]
  users: {},            // uid -> profile data
  unreadableUsers: [],  // uids whose profile read throws
  authUsers: {},        // uid -> Auth UserRecord
  authThrows: false,
};
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

jest.mock('../../firebaseAdmin', () => ({
  admin: { firestore: { FieldValue: { serverTimestamp: () => '__ts', delete: () => '__del' } } },
  db: {
    batch: () => ({ set: (...a) => mockBatchSet(...a), commit: (...a) => mockBatchCommit(...a) }),
    collection: (name) => {
      if (name === 'users') {
        return {
          doc: (uid) => ({
            get: async () => {
              if (state.unreadableUsers.includes(uid)) throw new Error('permission denied');
              return uid in state.users
                ? { exists: true, data: () => state.users[uid] }
                : { exists: false };
            },
            set: jest.fn().mockResolvedValue(),
          }),
        };
      }
      // memberships
      return {
        where: (field, op, value) => ({
          get: async () => {
            const docs = state.memberships
              .filter((m) => m[field] === value)
              .map((m) => ({ id: m.id, data: () => m }));
            return { docs, forEach: (fn) => docs.forEach(fn), empty: docs.length === 0 };
          },
          where: () => ({ get: async () => ({ empty: true, forEach: () => {} }) }),
        }),
      };
    },
  },
  auth: {
    getUsers: async (identifiers) => {
      if (state.authThrows) throw new Error('auth unavailable');
      const users = [];
      const notFound = [];
      identifiers.forEach(({ uid }) => {
        if (state.authUsers[uid]) users.push({ uid, ...state.authUsers[uid] });
        else notFound.push({ uid });
      });
      return { users, notFound };
    },
  },
}));

const { listCompanyTeam } = require('../../hrAdmin');

const req = (roles, data) => ({ auth: { uid: 'caller', token: { roles } }, data });
const asAdmin = (data = { companyId: 'co-a' }) => listCompanyTeam(req({ 'co-a': 'company_admin' }, data));
const byId = (res, id) => res.members.find((m) => m.id === id);

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchCommit.mockResolvedValue();
  state.memberships = [];
  state.users = {};
  state.unreadableUsers = [];
  state.authUsers = {};
  state.authThrows = false;
});

describe('listCompanyTeam authorization mirrors the existing UI gate', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(listCompanyTeam({ data: { companyId: 'co-a' } }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('requires a companyId', async () => {
    await expect(listCompanyTeam(req({ 'co-a': 'company_admin' }, {})))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(listCompanyTeam(req({ 'co-a': 'company_admin' }, { companyId: '  ' })))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects a non-admin of the requested company', async () => {
    await expect(listCompanyTeam(req({ 'co-a': 'recruiter' }, { companyId: 'co-a' })))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects a company_admin of a DIFFERENT company (no cross-tenant roster)', async () => {
    await expect(listCompanyTeam(req({ 'co-b': 'company_admin' }, { companyId: 'co-a' })))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('allows a super admin', async () => {
    const res = await listCompanyTeam(req({ globalRole: 'super_admin' }, { companyId: 'co-a' }));
    expect(res.members).toEqual([]);
  });
});

describe('listCompanyTeam resolves real identities', () => {
  it('reads a complete profile as an active member', async () => {
    state.memberships = [{ id: 'm1', userId: 'u1', companyId: 'co-a', role: 'recruiter' }];
    state.users = { u1: { name: 'Ann Adams', email: 'ann@example.test' } };
    state.authUsers = { u1: { displayName: 'Ann Adams', email: 'ann@example.test' } };

    const res = await asAdmin();
    expect(byId(res, 'u1')).toMatchObject({
      name: 'Ann Adams', email: 'ann@example.test', role: 'recruiter',
      status: 'active', profileMissing: false, repaired: false, duplicateMembershipCount: 0,
    });
    expect(res.repairedCount).toBe(0);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  // The exact production case: a user who already existed before being added to
  // the company, so no `users/{uid}` document was ever written.
  it('recovers an EXISTING user with no profile document from Firebase Auth', async () => {
    state.memberships = [{ id: 'm1', userId: 'u2', companyId: 'co-a', role: 'hr_user' }];
    state.authUsers = { u2: { displayName: 'Ben Brown', email: 'ben@example.test' } };

    const res = await asAdmin();
    expect(byId(res, 'u2')).toMatchObject({
      name: 'Ben Brown', email: 'ben@example.test',
      status: 'active', profileMissing: true, repaired: true,
    });
  });

  it('repairs the profile so later direct reads resolve too', async () => {
    state.memberships = [{ id: 'm1', userId: 'u2', companyId: 'co-a', role: 'hr_user' }];
    state.authUsers = { u2: { displayName: 'Ben Brown', email: 'ben@example.test' } };

    const res = await asAdmin();
    expect(res.repairedCount).toBe(1);
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      { name: 'Ben Brown', email: 'ben@example.test' },
      { merge: true },
    );
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('resolves the older field names the modal never understood', async () => {
    state.memberships = [
      { id: 'm1', userId: 'u3', companyId: 'co-a', role: 'recruiter' },
      { id: 'm2', userId: 'u4', companyId: 'co-a', role: 'recruiter' },
      { id: 'm3', userId: 'u5', companyId: 'co-a', role: 'recruiter' },
    ];
    state.users = {
      u3: { fullName: 'Cara Cole', email: 'cara@example.test' },
      u4: { displayName: 'Dan Diaz', email: 'dan@example.test' },
      u5: { firstName: 'Eve', lastName: 'Ellis', email: 'eve@example.test' },
    };
    state.authUsers = { u3: {}, u4: {}, u5: {} };

    const res = await asAdmin();
    expect(byId(res, 'u3').name).toBe('Cara Cole');
    expect(byId(res, 'u4').name).toBe('Dan Diaz');
    expect(byId(res, 'u5').name).toBe('Eve Ellis');
    expect(res.members.every((m) => m.status === 'active')).toBe(true);
  });

  it('recovers identity from a profile that holds only companyIds', async () => {
    state.memberships = [{ id: 'm1', userId: 'u6', companyId: 'co-a', role: 'recruiter' }];
    state.users = { u6: { companyIds: ['co-a'] } };
    state.authUsers = { u6: { displayName: 'Fay Fox', email: 'fay@example.test' } };

    expect(byId(await asAdmin(), 'u6')).toMatchObject({
      name: 'Fay Fox', email: 'fay@example.test', status: 'active', repaired: true, profileMissing: false,
    });
  });

  it('sorts members by display name', async () => {
    state.memberships = [
      { id: 'm1', userId: 'u1', companyId: 'co-a', role: 'recruiter' },
      { id: 'm2', userId: 'u2', companyId: 'co-a', role: 'recruiter' },
    ];
    state.users = { u1: { name: 'Zoe Zane' }, u2: { name: 'Ann Adams' } };
    state.authUsers = { u1: {}, u2: {} };

    expect((await asAdmin()).members.map((m) => m.name)).toEqual(['Ann Adams', 'Zoe Zane']);
  });

  it('ignores memberships belonging to other companies', async () => {
    state.memberships = [
      { id: 'm1', userId: 'u1', companyId: 'co-a', role: 'recruiter' },
      { id: 'm2', userId: 'u9', companyId: 'co-b', role: 'recruiter' },
    ];
    state.users = { u1: { name: 'Ann Adams' }, u9: { name: 'Other Co' } };
    state.authUsers = { u1: {}, u9: {} };

    const res = await asAdmin();
    expect(res.members).toHaveLength(1);
    expect(res.members[0].id).toBe('u1');
  });
});

describe('listCompanyTeam classifies broken records instead of hiding them', () => {
  it('flags a membership whose Auth account no longer exists as auth_missing', async () => {
    state.memberships = [{ id: 'm1', userId: 'ghost', companyId: 'co-a', role: 'recruiter' }];
    state.users = { ghost: { name: 'Gone Gray', email: 'gone@example.test' } };

    expect(byId(await asAdmin(), 'ghost')).toMatchObject({
      name: 'Gone Gray', email: 'gone@example.test', status: 'auth_missing',
    });
  });

  it('flags a fully orphaned membership — no Auth account and no profile', async () => {
    state.memberships = [{ id: 'm1', userId: 'orphan', companyId: 'co-a', role: 'recruiter' }];

    expect(byId(await asAdmin(), 'orphan')).toMatchObject({
      name: null, email: null, status: 'auth_missing', profileMissing: true, repaired: false,
    });
  });

  it('does not attempt a repair for an orphan with nothing to write', async () => {
    state.memberships = [{ id: 'm1', userId: 'orphan', companyId: 'co-a', role: 'recruiter' }];
    await asAdmin();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('flags an unreadable profile distinctly from a missing one', async () => {
    state.memberships = [{ id: 'm1', userId: 'locked', companyId: 'co-a', role: 'recruiter' }];
    state.unreadableUsers = ['locked'];
    state.authUsers = { locked: { displayName: 'Locked Lee', email: 'locked@example.test' } };
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Identity still recovered from Auth, but the row is reported as unreadable
    // and is NOT written back, because we cannot see what is already there.
    expect(byId(await asAdmin(), 'locked')).toMatchObject({
      name: 'Locked Lee', status: 'unreadable', profileMissing: false, repaired: false,
    });
    expect(mockBatchCommit).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('flags a member with no name and no email anywhere as unidentified', async () => {
    state.memberships = [{ id: 'm1', userId: 'u7', companyId: 'co-a', role: 'recruiter' }];
    state.users = { u7: { companyIds: ['co-a'] } };
    state.authUsers = { u7: {} };

    expect(byId(await asAdmin(), 'u7')).toMatchObject({
      name: null, email: null, status: 'unidentified',
    });
  });

  it('collapses duplicate membership documents into one row with a count', async () => {
    state.memberships = [
      { id: 'm1', userId: 'u8', companyId: 'co-a', role: 'recruiter' },
      { id: 'm2', userId: 'u8', companyId: 'co-a', role: 'hr_user' },
    ];
    state.users = { u8: { name: 'Dup Dana', email: 'dana@example.test' } };
    state.authUsers = { u8: {} };

    const res = await asAdmin();
    expect(res.members).toHaveLength(1);
    expect(res.members[0]).toMatchObject({
      id: 'u8', name: 'Dup Dana', duplicateMembershipCount: 1, membershipIds: ['m1', 'm2'],
    });
  });

  it('reports memberships with no userId separately, never as a member row', async () => {
    state.memberships = [
      { id: 'm-broken', companyId: 'co-a', role: 'recruiter' },
      { id: 'm-blank', userId: '   ', companyId: 'co-a', role: null },
      { id: 'm1', userId: 'u1', companyId: 'co-a', role: 'recruiter' },
    ];
    state.users = { u1: { name: 'Ann Adams' } };
    state.authUsers = { u1: {} };

    const res = await asAdmin();
    expect(res.members).toHaveLength(1);
    expect(res.invalidMemberships).toEqual([
      { membershipId: 'm-broken', role: 'recruiter' },
      { membershipId: 'm-blank', role: null },
    ]);
  });
});

describe('listCompanyTeam degrades safely', () => {
  it('still returns the roster from Firestore when the Auth lookup fails', async () => {
    state.memberships = [{ id: 'm1', userId: 'u1', companyId: 'co-a', role: 'recruiter' }];
    state.users = { u1: { name: 'Ann Adams', email: 'ann@example.test' } };
    state.authThrows = true;
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await asAdmin();
    expect(res.members[0]).toMatchObject({ name: 'Ann Adams', email: 'ann@example.test' });
    consoleError.mockRestore();
  });

  it('still returns the roster when the repair write fails', async () => {
    state.memberships = [{ id: 'm1', userId: 'u2', companyId: 'co-a', role: 'hr_user' }];
    state.authUsers = { u2: { displayName: 'Ben Brown', email: 'ben@example.test' } };
    mockBatchCommit.mockRejectedValueOnce(new Error('write failed'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await asAdmin();
    expect(res.members[0].name).toBe('Ben Brown');
    consoleError.mockRestore();
  });
});
