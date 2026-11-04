/**
 * The team list `onMembershipWrite` saves on the company document
 * (`companies/{id}.teamMembers`), which the Assign To pickers, the Assigned to
 * filter and Referral Links read. Each entry names the member by the project's
 * rule (`nameFromProfile` / `emailFromProfile` in `shared/userIdentity.js`, the
 * one Settings → Team uses), keeps `'Unknown'` and `''` as the none values the
 * screens read as "no name", and every profile is read in one `getAll`.
 *
 * Artificial companies, uids, names and addresses only.
 */
jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));
// The trigger is registered with onDocumentWritten({...}, handler) — hand the
// handler back so it can be invoked directly.
jest.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  onDocumentUpdated: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
}));

const mockState = { memberships: [], profiles: {} }; // memberships: [{ userId, companyId, role }]; profiles: uid -> users/{uid}
const mockSetCustomUserClaims = jest.fn();
const mockUserSet = jest.fn();
const mockUserGet = jest.fn();
const mockGetAll = jest.fn();
const mockCompanyUpdate = jest.fn();
const mockGetUser = jest.fn();

/** `users/{uid}` as the Admin SDK answers it: absent unless the fixture holds it. */
const mockProfileSnap = (uid) => {
  const exists = Object.prototype.hasOwnProperty.call(mockState.profiles, uid);
  return { id: uid, exists, data: () => (exists ? mockState.profiles[uid] : undefined) };
};

jest.mock('../../firebaseAdmin', () => ({
  admin: { firestore: { FieldValue: { serverTimestamp: () => '__ts' } } },
  db: {
    getAll: (...refs) => mockGetAll(...refs),
    collection: (name) => {
      if (name === 'users') {
        return {
          doc: (uid) => ({
            id: uid,
            set: (...a) => mockUserSet(uid, ...a),
            get: () => mockUserGet(uid),
          }),
        };
      }
      if (name === 'companies') {
        return {
          doc: (cid) => ({
            update: (...a) => mockCompanyUpdate(cid, ...a),
            // Every company here is active.
            get: async () => ({ exists: false }),
          }),
        };
      }
      // memberships
      return {
        where: (field, _op, value) => ({
          get: async () => {
            const docs = mockState.memberships
              .filter((m) => m[field] === value)
              .map((m, i) => ({ id: `m${i}`, data: () => m }));
            return { docs, forEach: (fn) => docs.forEach(fn), empty: docs.length === 0 };
          },
        }),
      };
    },
  },
  auth: {
    getUser: (...a) => mockGetUser(...a),
    setCustomUserClaims: (...a) => mockSetCustomUserClaims(...a),
  },
}));

const { onMembershipWrite } = require('../../hrAdmin');

/** Fire the trigger for one membership changing from `before` to `after`. */
const fire = (after, before) => onMembershipWrite({
  data: { before: { data: () => before }, after: { data: () => after } },
});
const joinCoA = (userId) => fire({ userId, companyId: 'co-a', role: 'recruiter' }, undefined);

/** The team list written to `companyId`, or undefined when it was not written. */
const writtenTeam = (companyId = 'co-a') => {
  const call = mockCompanyUpdate.mock.calls.find(([cid]) => cid === companyId);
  return call ? call[1].teamMembers : undefined;
};
const readUids = (call = 0) => mockGetAll.mock.calls[call].map((ref) => ref.id);

beforeEach(() => {
  jest.resetAllMocks();
  // Jest 30's reset leaves every double returning undefined: put the defaults back.
  mockGetUser.mockImplementation(async (uid) => ({ uid }));
  mockSetCustomUserClaims.mockResolvedValue();
  mockUserSet.mockResolvedValue();
  mockCompanyUpdate.mockResolvedValue();
  mockUserGet.mockImplementation(async (uid) => mockProfileSnap(uid));
  mockGetAll.mockImplementation(async (...refs) => refs.map((ref) => mockProfileSnap(ref.id)));
  mockState.memberships = [];
  mockState.profiles = {};
});

describe('onMembershipWrite — the saved team list names members by the shared rule', () => {
  it.each([
    ['fullName', { fullName: 'Fiona Full', email: 'fiona@example.com' }, 'Fiona Full', 'fiona@example.com'],
    ['displayName', { displayName: 'Dana Display', email: 'dana@example.com' }, 'Dana Display', 'dana@example.com'],
    ['first + last name, trimmed', { firstName: '  Pat ', lastName: ' Parts  ', email: ' pat@example.com ' }, 'Pat Parts', 'pat@example.com'],
    ['name before fullName and displayName', { name: 'Nora Name', fullName: 'Other Full', displayName: 'Other Display' }, 'Nora Name', ''],
    ['the next field when name is only spaces', { name: '   ', displayName: 'Wes Whitespace' }, 'Wes Whitespace', ''],
  ])('names a member from %s', async (_label, profile, name, email) => {
    mockState.memberships = [{ userId: 'u1', companyId: 'co-a', role: 'recruiter' }];
    mockState.profiles = { u1: profile };

    await joinCoA('u1');

    expect(writtenTeam()).toStrictEqual([{ userId: 'u1', role: 'recruiter', name, email }]);
  });

  it("writes 'Unknown' and '' when the profile is missing, or has no name and no email", async () => {
    mockState.memberships = [
      { userId: 'u-gone', companyId: 'co-a', role: 'recruiter' },
      { userId: 'u-bare', companyId: 'co-a', role: 'hr_user' },
    ];
    mockState.profiles = { 'u-bare': { companyIds: ['co-a'] } }; // u-gone has no users/{uid}

    await joinCoA('u-gone');

    expect(writtenTeam()).toStrictEqual([
      { userId: 'u-gone', role: 'recruiter', name: 'Unknown', email: '' },
      { userId: 'u-bare', role: 'hr_user', name: 'Unknown', email: '' },
    ]);
  });

  it('reads every profile with one getAll, each user once, and no per-user get', async () => {
    mockState.memberships = [
      { userId: 'u1', companyId: 'co-a', role: 'company_admin' },
      { userId: 'u2', companyId: 'co-a', role: 'recruiter' },
      { userId: 'u1', companyId: 'co-a', role: 'hr_user' },
      { userId: 'u3', companyId: 'co-a', role: 'hr_user' },
    ];

    await joinCoA('u2');

    expect(mockUserGet).not.toHaveBeenCalled();
    expect(mockGetAll).toHaveBeenCalledTimes(1);
    expect(readUids()).toEqual(['u1', 'u2', 'u3']);
  });

  it('keeps the memberships order, one entry per membership, userId and role as stored, and teamUpdatedAt', async () => {
    mockState.memberships = [
      { userId: 'u-b', companyId: 'co-a', role: 'recruiter' },
      { userId: 'u-a', companyId: 'co-a', role: 'company_admin' },
      // Two memberships of one user in one company stay two entries.
      { userId: 'u-b', companyId: 'co-a', role: 'hr_user' },
    ];
    mockState.profiles = {
      'u-a': { name: 'Ada Admin', email: 'ada@example.com' },
      'u-b': { name: 'Ben Recruiter', email: 'ben@example.com' },
    };
    // The answers come back in another order than asked.
    mockGetAll.mockImplementation(async (...refs) => refs.map((ref) => mockProfileSnap(ref.id)).reverse());

    await joinCoA('u-a');

    expect(mockCompanyUpdate).toHaveBeenCalledTimes(1);
    expect(mockCompanyUpdate).toHaveBeenCalledWith('co-a', {
      teamMembers: [
        { userId: 'u-b', role: 'recruiter', name: 'Ben Recruiter', email: 'ben@example.com' },
        { userId: 'u-a', role: 'company_admin', name: 'Ada Admin', email: 'ada@example.com' },
        { userId: 'u-b', role: 'hr_user', name: 'Ben Recruiter', email: 'ben@example.com' },
      ],
      teamUpdatedAt: '__ts',
    });
    expect(Object.keys(mockCompanyUpdate.mock.calls[0][1]).sort()).toEqual(['teamMembers', 'teamUpdatedAt']);
  });

  it('writes an empty team when the last membership is removed, without calling getAll', async () => {
    mockState.memberships = [];

    await fire(undefined, { userId: 'u1', companyId: 'co-a', role: 'recruiter' });

    expect(mockCompanyUpdate).toHaveBeenCalledWith('co-a', { teamMembers: [], teamUpdatedAt: '__ts' });
    expect(mockGetAll).not.toHaveBeenCalled();
  });

  it("gives a membership without a userId the 'Unknown' entry and does not read it", async () => {
    mockState.memberships = [
      { companyId: 'co-a', role: 'recruiter' },
      { userId: '', companyId: 'co-a', role: 'recruiter' },
      { userId: 'u1', companyId: 'co-a', role: 'hr_user' },
    ];
    mockState.profiles = { u1: { name: 'Uma User', email: 'uma@example.com' } };

    await joinCoA('u1');

    expect(writtenTeam()).toStrictEqual([
      { userId: undefined, role: 'recruiter', name: 'Unknown', email: '' },
      { userId: '', role: 'recruiter', name: 'Unknown', email: '' },
      { userId: 'u1', role: 'hr_user', name: 'Uma User', email: 'uma@example.com' },
    ]);
    expect(mockGetAll).toHaveBeenCalledTimes(1);
    expect(readUids()).toEqual(['u1']);
  });

  it('a membership moved between companies rewrites each company from its own team, one getAll each', async () => {
    mockState.memberships = [
      { userId: 'u1', companyId: 'co-b', role: 'recruiter' },
      { userId: 'u2', companyId: 'co-a', role: 'company_admin' },
    ];
    mockState.profiles = { u1: { name: 'Uma User' }, u2: { name: 'Vic Admin' } };

    await fire({ userId: 'u1', companyId: 'co-b', role: 'recruiter' }, { userId: 'u1', companyId: 'co-a', role: 'recruiter' });

    expect(mockGetAll).toHaveBeenCalledTimes(2);
    expect(writtenTeam('co-a')).toStrictEqual([{ userId: 'u2', role: 'company_admin', name: 'Vic Admin', email: '' }]);
    expect(writtenTeam('co-b')).toStrictEqual([{ userId: 'u1', role: 'recruiter', name: 'Uma User', email: '' }]);
  });

  it('leaves the saved list alone when getAll fails, and still writes the claims and companyIds', async () => {
    mockState.memberships = [{ userId: 'u1', companyId: 'co-a', role: 'recruiter' }];
    mockState.profiles = { u1: { name: 'Uma User' } };
    mockGetAll.mockRejectedValue(new Error('firestore unavailable'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(joinCoA('u1')).resolves.toBeUndefined();

      expect(mockGetAll).toHaveBeenCalledTimes(1);
      expect(mockCompanyUpdate).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith('Failed to update team cache for company co-a:', expect.any(Error));
      expect(mockSetCustomUserClaims).toHaveBeenCalledWith('u1', expect.objectContaining({ roles: { 'co-a': 'recruiter' } }));
      expect(mockUserSet).toHaveBeenCalledWith('u1', { companyIds: ['co-a'] }, { merge: true });
    } finally {
      consoleError.mockRestore();
    }
  });
});
