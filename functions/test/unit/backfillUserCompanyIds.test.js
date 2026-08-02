jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));

const mockGetUser = jest.fn();
const mockMembershipsGet = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockUserDoc = jest.fn((id) => ({ __userDocId: id }));

jest.mock('../../firebaseAdmin', () => ({
  admin: { auth: () => ({ getUser: (...a) => mockGetUser(...a) }) },
  db: {
    collection: (name) => {
      if (name === 'memberships') return { get: (...a) => mockMembershipsGet(...a) };
      if (name === 'users') return { doc: (id) => mockUserDoc(id) };
      return {};
    },
    batch: () => ({ set: (...a) => mockBatchSet(...a), commit: (...a) => mockBatchCommit(...a) }),
  },
}));

jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn().mockResolvedValue(true) }));

const { backfillUserCompanyIds } = require('../../backfillUserCompanyIds');

// Snapshot whose forEach yields {data:()=>row} for each membership row.
const snap = (rows) => ({ forEach: (cb) => rows.forEach((r) => cb({ data: () => r })) });
const superClaims = { customClaims: { roles: { globalRole: 'super_admin' } } };

describe('backfillUserCompanyIds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue(superClaims);
    mockMembershipsGet.mockResolvedValue(snap([]));
  });

  it('rejects unauthenticated callers', async () => {
    await expect(backfillUserCompanyIds({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects non-super-admin callers', async () => {
    mockGetUser.mockResolvedValue({ customClaims: { roles: { co1: 'company_admin' } } });
    await expect(backfillUserCompanyIds({ auth: { uid: 'admin' }, data: {} }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('dry run maps memberships without writing', async () => {
    mockMembershipsGet.mockResolvedValue(snap([
      { userId: 'u1', companyId: 'c1' },
      { userId: 'u2', companyId: 'c2' },
    ]));
    const res = await backfillUserCompanyIds({ auth: { uid: 'super' }, data: { dryRun: true } });
    expect(res).toMatchObject({ success: true, dryRun: true, usersProcessed: 2 });
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('live run writes deduped, sorted companyIds per user (merge) and skips rows missing ids', async () => {
    mockMembershipsGet.mockResolvedValue(snap([
      { userId: 'u1', companyId: 'c2' },
      { userId: 'u1', companyId: 'c1' },
      { userId: 'u1', companyId: 'c1' }, // duplicate
      { userId: 'u2', companyId: 'c1' },
      { userId: 'u3' },                  // no companyId -> skipped
      { companyId: 'c9' },               // no userId -> skipped
    ]));

    const res = await backfillUserCompanyIds({ auth: { uid: 'super' }, data: { dryRun: false } });
    expect(res).toMatchObject({ success: true, dryRun: false, usersProcessed: 2 });
    expect(mockBatchCommit).toHaveBeenCalled();

    // u1 -> ['c1','c2'] (deduped + sorted), merge:true
    expect(mockBatchSet).toHaveBeenCalledWith({ __userDocId: 'u1' }, { companyIds: ['c1', 'c2'] }, { merge: true });
    expect(mockBatchSet).toHaveBeenCalledWith({ __userDocId: 'u2' }, { companyIds: ['c1'] }, { merge: true });
    // u3 (no companyId) never written
    expect(mockUserDoc).not.toHaveBeenCalledWith('u3');
  });
});
