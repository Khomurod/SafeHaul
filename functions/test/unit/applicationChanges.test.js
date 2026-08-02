jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));
jest.mock('firebase-functions', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
jest.mock('uuid', () => ({ v4: () => 'tok-123' }));

const mockAssert = jest.fn().mockResolvedValue(undefined);
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAdminStrict: (...a) => mockAssert(...a) }));
const mockRateLimit = jest.fn().mockResolvedValue(true);
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: (...a) => mockRateLimit(...a) }));

// Mutable per-test state (mock-prefixed for jest hoisting).
const mockState = {
  appSnap: { exists: true, data: () => ({}) },
  pendingEmpty: true,
  pendingSize: 0,
  pendingDocs: [],
  reviewSnap: { exists: true, data: () => ({}) },
};
const mockBatch = { set: jest.fn(), commit: jest.fn().mockResolvedValue() };
const mockAdd = jest.fn().mockResolvedValue();
const mockAppRef = {
  get: () => Promise.resolve(mockState.appSnap),
  set: jest.fn().mockResolvedValue(),
  collection: (name) => {
    if (name === 'pending_changes') {
      return {
        doc: (id) => ({ __pc: id }),
        where: () => ({ limit: () => ({ get: () => Promise.resolve({ empty: mockState.pendingEmpty, size: mockState.pendingSize }) }) }),
        get: () => Promise.resolve({ docs: mockState.pendingDocs }),
      };
    }
    return { add: (...a) => mockAdd(...a) };
  },
};
const mockReviewRef = { get: () => Promise.resolve(mockState.reviewSnap), set: jest.fn().mockResolvedValue() };

jest.mock('../../firebaseAdmin', () => ({
  admin: {
    firestore: {
      FieldValue: { serverTimestamp: () => 'TS' },
      Timestamp: { now: () => ({ toMillis: () => 1000 }), fromMillis: (ms) => ({ toMillis: () => ms }) },
    },
  },
  db: {
    collection: (name) => (name === 'change_reviews'
      ? { doc: () => mockReviewRef }
      : { doc: () => ({ collection: () => ({ doc: () => mockAppRef }) }) }),
    batch: () => mockBatch,
  },
}));

const {
  proposeApplicationChanges, createChangeReview, getChangeReview, submitChangeResolution,
} = require('../../applicationChanges');

const auth = { uid: 'admin1', token: { name: 'Rec' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockAssert.mockResolvedValue(undefined);
  mockRateLimit.mockResolvedValue(true);
  mockState.appSnap = { exists: true, data: () => ({ firstName: 'John', lastName: 'Doe' }) };
  mockState.pendingEmpty = true; mockState.pendingSize = 0; mockState.pendingDocs = [];
  mockState.reviewSnap = { exists: true, data: () => ({ companyId: 'co1', applicationId: 'app1', collectionName: 'applications', applicantName: 'John Doe', expiresAt: { toMillis: () => Date.now() + 1e9 }, status: 'open' }) };
});

const target = { companyId: 'co1', applicationId: 'app1', collectionName: 'applications' };

describe('proposeApplicationChanges', () => {
  it('requires auth', async () => {
    await expect(proposeApplicationChanges({ data: { ...target, changes: [{ fieldKey: 'firstName', proposedValue: 'X' }] } }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('enforces company_admin RBAC', async () => {
    const denied = new Error('no'); denied.code = 'permission-denied';
    mockAssert.mockRejectedValueOnce(denied);
    await expect(proposeApplicationChanges({ auth, data: { ...target, changes: [{ fieldKey: 'firstName', proposedValue: 'X' }] } }))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('skips non-editable fields and unchanged values; writes only real edits + sets the flag', async () => {
    const res = await proposeApplicationChanges({ auth, data: { ...target, changes: [
      { fieldKey: 'firstName', proposedValue: 'Jonathan' },   // changed -> applied
      { fieldKey: 'lastName', proposedValue: 'Doe' },         // unchanged -> skipped
      { fieldKey: 'status', proposedValue: 'Hired' },         // not editable -> skipped
      { fieldKey: 'cdl-front', proposedValue: {} },           // file field -> skipped
    ] } });
    expect(res.applied).toEqual(['firstName']);
    expect(res.skipped).toEqual(expect.arrayContaining(['lastName', 'status', 'cdl-front']));
    // one pending_changes doc + the app-doc flag both written in the batch
    expect(mockBatch.set).toHaveBeenCalledTimes(2);
    expect(mockBatch.commit).toHaveBeenCalled();
    const flagCall = mockBatch.set.mock.calls.find((c) => c[1] && c[1].hasPendingCompanyChanges === true);
    expect(flagCall).toBeTruthy();
  });

  it('returns not-found for a missing application', async () => {
    mockState.appSnap = { exists: false };
    await expect(proposeApplicationChanges({ auth, data: { ...target, changes: [{ fieldKey: 'firstName', proposedValue: 'X' }] } }))
      .rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('createChangeReview', () => {
  it('fails when there are no pending changes', async () => {
    mockState.pendingEmpty = true;
    await expect(createChangeReview({ auth, data: target })).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('mints a token + path when pending changes exist', async () => {
    mockState.pendingEmpty = false;
    const res = await createChangeReview({ auth, data: target });
    expect(res).toMatchObject({ success: true, token: 'tok-123', path: '/review-change/tok-123' });
    expect(mockReviewRef.set).toHaveBeenCalled();
  });
});

describe('getChangeReview', () => {
  it('rate-limits', async () => {
    mockRateLimit.mockResolvedValueOnce(false);
    await expect(getChangeReview({ data: { token: 't' } })).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('rejects an expired link', async () => {
    mockState.reviewSnap = { exists: true, data: () => ({ companyId: 'co1', applicationId: 'app1', collectionName: 'applications', expiresAt: { toMillis: () => Date.now() - 1 } }) };
    await expect(getChangeReview({ data: { token: 't' } })).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('returns the pending changes (before/after)', async () => {
    mockState.pendingDocs = [{ id: 'firstName', data: () => ({ fieldKey: 'firstName', fieldLabel: 'First Name', originalValue: 'John', proposedValue: 'Jonathan', status: 'pending' }) }];
    const res = await getChangeReview({ data: { token: 't' } });
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0]).toMatchObject({ fieldKey: 'firstName', originalValue: 'John', proposedValue: 'Jonathan' });
  });
});

describe('submitChangeResolution', () => {
  beforeEach(() => {
    mockState.pendingDocs = [
      { id: 'firstName', data: () => ({ fieldKey: 'firstName', originalValue: 'John', proposedValue: 'Jonathan', status: 'pending' }) },
      { id: 'city', data: () => ({ fieldKey: 'city', originalValue: 'Reno', proposedValue: 'Sparks', status: 'pending' }) },
    ];
  });

  it('approve writes the proposed value; reject writes nothing to the doc', async () => {
    mockState.pendingSize = 1; // still one pending after (simulate not all resolved)
    mockState.pendingEmpty = false;
    await submitChangeResolution({ data: { token: 't', resolutions: [
      { fieldKey: 'firstName', action: 'approve' },
      { fieldKey: 'city', action: 'reject' },
    ] } });
    const docUpdate = mockBatch.set.mock.calls.find((c) => c[0] === mockAppRef && c[1] && 'firstName' in c[1]);
    expect(docUpdate[1]).toEqual({ firstName: 'Jonathan' }); // city reject => not in doc update
  });

  it('edit applies the driver value (final) and clears the mark when none remain', async () => {
    mockState.pendingSize = 0; mockState.pendingEmpty = true; // all resolved
    const res = await submitChangeResolution({ data: { token: 't', resolutions: [
      { fieldKey: 'firstName', action: 'edit', value: 'Johnny' },
      { fieldKey: 'city', action: 'approve' },
    ] } });
    const docUpdate = mockBatch.set.mock.calls.find((c) => c[0] === mockAppRef && c[1] && 'firstName' in c[1]);
    expect(docUpdate[1]).toMatchObject({ firstName: 'Johnny', city: 'Sparks' });
    expect(res).toMatchObject({ success: true, remaining: 0, completed: true });
    expect(mockAppRef.set).toHaveBeenCalledWith({ hasPendingCompanyChanges: false }, { merge: true });
    expect(mockReviewRef.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }), { merge: true });
  });
});
