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
}));

// Artificial companies, uids and roles only.
const state = { memberships: [] }; // [{ userId, companyId, role }]
const mockSetCustomUserClaims = jest.fn().mockResolvedValue();
const mockUserSet = jest.fn().mockResolvedValue();
const mockCompanyUpdate = jest.fn().mockResolvedValue();
const mockGetUser = jest.fn().mockResolvedValue({ uid: 'u1' });

jest.mock('../../firebaseAdmin', () => ({
  admin: { firestore: { FieldValue: { serverTimestamp: () => '__ts' } } },
  db: {
    collection: (name) => {
      if (name === 'users') {
        return {
          doc: (uid) => ({
            set: (...a) => mockUserSet(uid, ...a),
            get: async () => ({ exists: false }),
          }),
        };
      }
      if (name === 'companies') {
        return { doc: (cid) => ({ update: (...a) => mockCompanyUpdate(cid, ...a) }) };
      }
      // memberships
      return {
        where: (field, _op, value) => ({
          get: async () => {
            const docs = state.memberships
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

/** Fire the trigger for a membership write on `userId`. */
const fire = (userId) => onMembershipWrite({
  data: { before: { data: () => undefined }, after: { data: () => ({ userId, companyId: 'co-a', role: 'recruiter' }) } },
});

const claims = () => mockSetCustomUserClaims.mock.calls[0][1];
const writtenCompanyIds = () => {
  const call = mockUserSet.mock.calls.find((c) => c[1] && Array.isArray(c[1].companyIds));
  return call ? call[1].companyIds : undefined;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ uid: 'u1' });
  state.memberships = [];
});

describe('onMembershipWrite — users/{uid}.companyIds covers EVERY membership', () => {
  it('mirrors a staff membership onto companyIds and the companyTeamIds claim', async () => {
    state.memberships = [{ userId: 'u1', companyId: 'co-a', role: 'recruiter' }];
    await fire('u1');

    expect(writtenCompanyIds()).toEqual(['co-a']);
    expect(claims().companyTeamIds).toEqual(['co-a']);
    expect(claims().roles).toEqual({ 'co-a': 'recruiter' });
  });

  // THE DIVERGENCE: companyIds decides who may read THIS user's profile. Deriving
  // it from the staff-role allowlist left members holding any other role with
  // `companyIds: []`, so their own teammates were denied the read and the roster
  // showed them as "Unknown / No Email". It also reverted backfillUserCompanyIds,
  // which maps every membership that has a companyId.
  it('includes a company-scoped super_admin membership, which the allowlist dropped', async () => {
    state.memberships = [{ userId: 'u1', companyId: 'co-a', role: 'super_admin' }];
    await fire('u1');

    expect(writtenCompanyIds()).toEqual(['co-a']);
    // The capability claim is NOT widened — a super_admin gets its global role,
    // not a company staff-read claim minted from this allowlist.
    expect(claims().companyTeamIds).toBeUndefined();
    expect(claims().roles.globalRole).toBe('super_admin');
  });

  it('includes an unrecognised legacy role rather than dropping the company', async () => {
    state.memberships = [{ userId: 'u1', companyId: 'co-a', role: 'owner' }];
    await fire('u1');

    expect(writtenCompanyIds()).toEqual(['co-a']);
    expect(claims().companyTeamIds).toBeUndefined();
  });

  it('unions and sorts every company across mixed roles', async () => {
    state.memberships = [
      { userId: 'u1', companyId: 'co-c', role: 'owner' },
      { userId: 'u1', companyId: 'co-a', role: 'recruiter' },
      { userId: 'u1', companyId: 'co-b', role: 'super_admin' },
    ];
    await fire('u1');

    expect(writtenCompanyIds()).toEqual(['co-a', 'co-b', 'co-c']);
    // Staff-read capability stays limited to the company where the role is staff.
    expect(claims().companyTeamIds).toEqual(['co-a']);
  });

  it('empties companyIds when the last membership is removed', async () => {
    state.memberships = [];
    await onMembershipWrite({
      data: {
        before: { data: () => ({ userId: 'u1', companyId: 'co-a', role: 'recruiter' }) },
        after: { data: () => undefined },
      },
    });

    expect(writtenCompanyIds()).toEqual([]);
  });

  it('skips a membership with no companyId (a global super_admin grant)', async () => {
    state.memberships = [{ userId: 'u1', role: 'super_admin' }];
    await fire('u1');

    expect(writtenCompanyIds()).toEqual([]);
    expect(claims().roles.globalRole).toBe('super_admin');
  });

  it('does nothing when the Auth account is gone', async () => {
    const notFound = new Error('nf'); notFound.code = 'auth/user-not-found';
    mockGetUser.mockRejectedValue(notFound);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await fire('u1');
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    expect(mockUserSet).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
