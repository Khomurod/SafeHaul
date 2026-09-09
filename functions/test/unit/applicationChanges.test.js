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

/**
 * Employers, through the whole approval workflow.
 *
 * `employers` is the one editable field that is not just a value: a Previous
 * Employment Verification mirror lives on each row, so a whole-array replacement
 * from a browser could move one employer's completed verification onto another.
 * These cases drive the two callables that write that array and assert the
 * property in both — see `shared/employerEdits.js` for why the resolution pass is
 * the authoritative one.
 */
describe('employers through the approval workflow', () => {
  const ABC = { employerId: 'aaaaaaaaaaaa', companyName: 'ABC Trucking', verification: { status: 'Completed', respondentName: 'Pat' } };
  const XYZ = { employerId: 'bbbbbbbbbbbb', companyName: 'XYZ Transport' };

  /** The pending change as `submitChangeResolution` reads it back. */
  const pendingEmployers = (proposedValue) => [{
    id: 'employers',
    data: () => ({
      fieldKey: 'employers', status: 'pending',
      originalValue: [ABC, XYZ], proposedValue,
    }),
  }];

  const employersWritten = () => {
    const call = mockBatch.set.mock.calls.find(([ref]) => ref === mockAppRef);
    return call ? call[1].employers : undefined;
  };

  beforeEach(() => {
    mockState.appSnap = { exists: true, data: () => ({ firstName: 'John', employers: [ABC, XYZ] }) };
  });

  it('proposes an added employer with an identity and no verification', async () => {
    const res = await proposeApplicationChanges({
      auth,
      data: {
        ...target,
        changes: [{ fieldKey: 'employers', proposedValue: [ABC, XYZ, { companyName: 'New Freight Co' }] }],
      },
    });

    expect(res.applied).toContain('employers');
    const written = mockBatch.set.mock.calls.find(([ref]) => ref.__pc === 'employers')[1];
    expect(written.proposedValue).toHaveLength(3);
    expect(written.proposedValue[2].employerId).toMatch(/^[0-9a-f]{12}$/);
    expect(written.proposedValue[2].verification).toBeUndefined();
    // And the existing row keeps its own.
    expect(written.proposedValue[0].verification).toMatchObject({ status: 'Completed' });
  });

  it('strips a verification block the client tried to send', async () => {
    await proposeApplicationChanges({
      auth,
      data: {
        ...target,
        changes: [{
          fieldKey: 'employers',
          // XYZ, carrying ABC's completed verification. This is the corruption.
          proposedValue: [{ ...XYZ, verification: { status: 'Completed', respondentName: 'Pat' } }],
        }],
      },
    });

    const written = mockBatch.set.mock.calls.find(([ref]) => ref.__pc === 'employers')[1];
    expect(written.proposedValue[0].companyName).toBe('XYZ Transport');
    expect(written.proposedValue[0].verification).toBeUndefined();
  });

  it('records the removal, and the verification state that went with it', async () => {
    await proposeApplicationChanges({
      auth,
      data: { ...target, changes: [{ fieldKey: 'employers', proposedValue: [XYZ] }] },
    });

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      action: 'Company Edit Proposed',
      details: expect.stringContaining('ABC Trucking (verification: Completed)'),
    }));
  });

  it('re-attaches verification from the LIVE record when the driver approves', async () => {
    // The proposal was written before ABC's verification completed; approving its
    // stored snapshot would roll that completion back.
    mockState.pendingDocs = pendingEmployers([
      { employerId: 'aaaaaaaaaaaa', companyName: 'ABC Trucking' },
      XYZ,
    ]);
    mockState.appSnap = {
      exists: true,
      data: () => ({ employers: [{ ...ABC, verification: { status: 'Completed', respondentName: 'Later' } }, XYZ] }),
    };

    await submitChangeResolution({
      data: { token: 'tok-123', resolutions: [{ fieldKey: 'employers', action: 'approve' }] },
    });

    expect(employersWritten()[0].verification).toMatchObject({ respondentName: 'Later' });
  });

  it('will not let the driver’s own edit set a verification', async () => {
    // `submitChangeResolution` writes `r.value` straight onto the document, so the
    // review portal is a write surface with no other validation on this field.
    mockState.pendingDocs = pendingEmployers([XYZ]);

    await submitChangeResolution({
      data: {
        token: 'tok-123',
        resolutions: [{
          fieldKey: 'employers',
          action: 'edit',
          value: [{ ...XYZ, verification: { status: 'Completed', respondentName: 'Forged' } }],
        }],
      },
    });

    const written = employersWritten();
    expect(written[0].companyName).toBe('XYZ Transport');
    expect(written[0].verification).toBeUndefined();
  });

  it('leaves the record alone when the driver rejects', async () => {
    mockState.pendingDocs = pendingEmployers([XYZ]);

    await submitChangeResolution({
      data: { token: 'tok-123', resolutions: [{ fieldKey: 'employers', action: 'reject' }] },
    });

    // No write to the application document at all: the canonical original stands.
    expect(employersWritten()).toBeUndefined();
    expect(mockBatch.set).toHaveBeenCalledWith(
      { __pc: 'employers' },
      expect.objectContaining({ status: 'rejected' }),
      { merge: true },
    );
  });

  it('names the removal in the driver-review audit line too', async () => {
    mockState.pendingDocs = pendingEmployers([XYZ]);

    await submitChangeResolution({
      data: { token: 'tok-123', resolutions: [{ fieldKey: 'employers', action: 'approve' }] },
    });

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      action: 'Driver Reviewed Company Edits',
      details: expect.stringContaining('ABC Trucking (verification: Completed)'),
    }));
  });

  it('never writes to the frozen submission snapshot', async () => {
    // `companies/{id}/applications/{appId}/submission/{version}` is Admin-SDK-only
    // and immutable. Nothing on this path may reach it — the only subcollections
    // touched are `pending_changes` and `activity_logs`.
    mockState.pendingDocs = pendingEmployers([XYZ]);
    await proposeApplicationChanges({
      auth, data: { ...target, changes: [{ fieldKey: 'employers', proposedValue: [XYZ] }] },
    });
    await submitChangeResolution({
      data: { token: 'tok-123', resolutions: [{ fieldKey: 'employers', action: 'approve' }] },
    });

    const written = mockBatch.set.mock.calls.map(([ref]) => (ref.__pc ? `pending_changes/${ref.__pc}` : 'application'));
    expect(written.every((path) => path === 'application' || path.startsWith('pending_changes/'))).toBe(true);
    expect(mockAdd.mock.calls.every(([row]) => typeof row.action === 'string')).toBe(true);
  });
});
