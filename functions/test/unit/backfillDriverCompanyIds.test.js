jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));

const mockGetUser = jest.fn();
const mockGetAll = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockCollectionGroupData = {}; // name -> [docs] (mock-prefixed so the factory may use it)

const mockMakeSnap = (docs) => ({ empty: docs.length === 0, size: docs.length, docs });

// Chainable collection-group query whose .get() returns the seeded docs once,
// then empty (small datasets end after one page since size < PAGE_SIZE anyway).
const mockMakeQuery = (name) => ({
  orderBy() { return this; },
  limit() { return this; },
  startAfter() {
    return { // second page -> empty
      orderBy() { return this; }, limit() { return this; }, startAfter() { return this; },
      get: async () => mockMakeSnap([]),
    };
  },
  get: async () => mockMakeSnap(mockCollectionGroupData[name] || []),
});

jest.mock('../../firebaseAdmin', () => ({
  admin: {
    auth: () => ({ getUser: (...a) => mockGetUser(...a) }),
    firestore: {
      FieldPath: { documentId: () => 'DOCID' },
      FieldValue: { arrayUnion: (...vals) => ({ __arrayUnion: vals }) },
    },
  },
  db: {
    collectionGroup: (name) => mockMakeQuery(name),
    collection: () => ({ doc: (id) => ({ id, __ref: `drivers/${id}` }) }),
    getAll: (...refs) => mockGetAll(...refs),
    batch: () => ({ set: (...a) => mockBatchSet(...a), commit: (...a) => mockBatchCommit(...a) }),
  },
}));

jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn().mockResolvedValue(true) }));

const { backfillDriverCompanyIds } = require('../../backfillDriverCompanyIds');

const superClaims = { customClaims: { roles: { globalRole: 'super_admin' } } };
const appDoc = (path, id, data) => ({ ref: { path }, id, data: () => data });

describe('backfillDriverCompanyIds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue(superClaims);
    mockCollectionGroupData.applications = [
      appDoc('companies/co1/applications/app1', 'app1', { driverId: 'd1', applicantId: 'a1' }),
      appDoc('companies/co2/applications/app2', 'app2', { driverId: 'd1' }),
    ];
    mockCollectionGroupData.leads = [
      appDoc('companies/co1/leads/lead1', 'lead1', { userId: 'd2' }),
    ];
    // d1 and d2 have real driver docs; a1 does not.
    mockGetAll.mockImplementation((...refs) =>
      Promise.resolve(refs.map((r) => ({ id: r.id, ref: r, exists: r.id !== 'a1' }))));
  });

  it('rejects non-super-admin callers', async () => {
    mockGetUser.mockResolvedValue({ customClaims: { roles: { co1: 'company_admin' } } });
    await expect(backfillDriverCompanyIds({ auth: { uid: 'admin' }, data: {} }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('dry run maps applications/leads to drivers without writing', async () => {
    const res = await backfillDriverCompanyIds({ auth: { uid: 'super' }, data: { dryRun: true } });
    expect(res).toMatchObject({
      success: true, dryRun: true,
      applicationsScanned: 2, leadsScanned: 1,
      driverProfilesUpdated: 2,           // d1, d2 exist
      referencedDriverIdsWithoutProfile: 1, // a1 missing
    });
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('live run arrayUnions company ids onto existing driver docs only', async () => {
    const res = await backfillDriverCompanyIds({ auth: { uid: 'super' }, data: { dryRun: false } });
    expect(res).toMatchObject({ dryRun: false, driverProfilesUpdated: 2, referencedDriverIdsWithoutProfile: 1 });
    expect(mockBatchCommit).toHaveBeenCalled();

    const calls = mockBatchSet.mock.calls;
    const byId = Object.fromEntries(calls.map(([ref, payload]) => [ref.id, payload.companyIds.__arrayUnion.sort()]));
    // d1 connected to co1 (app1) + co2 (app2); d2 connected to co1 (lead1); a1 never written (no doc).
    expect(byId.d1).toEqual(['co1', 'co2']);
    expect(byId.d2).toEqual(['co1']);
    expect(byId).not.toHaveProperty('a1');
  });
});
