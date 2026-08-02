jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: jest.fn(() => () => {}) }));

const DELETE_SENTINEL = '__delete__';

// State referenced inside the jest.mock factory must be `mock`-prefixed.
let mockSmsDocData;            // current sms_provider doc data (or null = missing)
let mockMembershipDocs;        // docs returned for the userId+companyId membership query
let mockRemainingAfterDelete;  // docs for the "remaining memberships" orphan check

const mockSmsUpdate = jest.fn().mockResolvedValue();
const mockSmsGet = jest.fn(() => Promise.resolve({
  exists: mockSmsDocData !== null,
  data: () => mockSmsDocData,
}));
const mockMembershipBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

jest.mock('../../firebaseAdmin', () => ({
  admin: { firestore: { FieldValue: { delete: () => '__delete__', serverTimestamp: () => '__ts' } } },
  db: {
    collection: (name) => {
      if (name === 'companies') {
        return {
          doc: () => ({
            collection: () => ({
              doc: () => ({
                get: (...a) => mockSmsGet(...a),
                update: (...a) => mockSmsUpdate(...a),
              }),
            }),
          }),
        };
      }
      if (name === 'users') {
        return { doc: () => ({ delete: jest.fn().mockResolvedValue() }) };
      }
      // memberships: the company-admin path chains two .where() (userId + companyId);
      // the later orphan check uses a single .where(userId).
      const makeQuery = (depth) => ({
        where: () => makeQuery(depth + 1),
        get: () => Promise.resolve(depth >= 2
          ? { forEach: (cb) => mockMembershipDocs.forEach(cb), docs: mockMembershipDocs }
          : { empty: mockRemainingAfterDelete.length === 0, forEach: (cb) => mockRemainingAfterDelete.forEach(cb), docs: mockRemainingAfterDelete }),
      });
      return makeQuery(0);
    },
    batch: () => ({ delete: (...a) => mockMembershipBatchDelete(...a), commit: (...a) => mockBatchCommit(...a) }),
  },
  auth: { deleteUser: jest.fn().mockResolvedValue() },
}));

const { deletePortalUser } = require('../../hrAdmin');

const req = (roles, data) => ({ auth: { uid: 'caller', token: { roles } }, data });
const memDoc = (companyId) => ({ ref: { id: 'mem_' + companyId }, data: () => ({ userId: 'recruiterX', companyId }) });

describe('deletePortalUser — frees SMS line assignment on removal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSmsDocData = { assignments: { recruiterX: '+15550000002', someoneElse: '+15550000003' } };
    mockMembershipDocs = [memDoc('co1')];
    mockRemainingAfterDelete = []; // user has no other memberships
  });

  it('clears the removed user from the company sms_provider assignments map', async () => {
    const res = await deletePortalUser(req({ co1: 'company_admin' }, { userId: 'recruiterX', companyId: 'co1' }));
    expect(res.message).toMatch(/removed/i);
    expect(mockSmsUpdate).toHaveBeenCalledWith({ 'assignments.recruiterX': DELETE_SENTINEL });
  });

  it('does NOT touch the assignments map when the user had no assigned line', async () => {
    mockSmsDocData = { assignments: { someoneElse: '+15550000003' } };
    await deletePortalUser(req({ co1: 'company_admin' }, { userId: 'recruiterX', companyId: 'co1' }));
    expect(mockSmsUpdate).not.toHaveBeenCalled();
  });

  it('survives a missing sms_provider doc (user removal still succeeds)', async () => {
    mockSmsDocData = null;
    const res = await deletePortalUser(req({ co1: 'company_admin' }, { userId: 'recruiterX', companyId: 'co1' }));
    expect(res.message).toMatch(/removed/i);
    expect(mockSmsUpdate).not.toHaveBeenCalled();
  });

  it('rejects callers who are neither super admin nor company admin', async () => {
    await expect(
      deletePortalUser(req({ co1: 'recruiter' }, { userId: 'recruiterX', companyId: 'co1' })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockSmsUpdate).not.toHaveBeenCalled();
  });
});
