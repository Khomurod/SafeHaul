jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message, details) { super(message); this.code = code; this.details = details; }
  },
}));
jest.mock('firebase-functions', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
jest.mock('uuid', () => ({ v4: () => 'tok-123' }));

const mockAssert = jest.fn();
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAdminStrict: (...a) => mockAssert(...a) }));
const mockRateLimit = jest.fn();
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: (...a) => mockRateLimit(...a) }));

// Mutable per-test state (mock-prefixed for jest hoisting).
const mockState = {
  appSnap: { exists: true, data: () => ({}) },
  pendingEmpty: true,
  pendingSize: 0,
  pendingDocs: [],
  reviewSnap: { exists: true, data: () => ({}) },
};
const mockBatch = { set: jest.fn(), update: jest.fn(), commit: jest.fn() };
const mockAdd = jest.fn();
const mockAppRef = {
  get: () => Promise.resolve(mockState.appSnap),
  set: jest.fn(),
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
const mockReviewRef = { get: () => Promise.resolve(mockState.reviewSnap), set: jest.fn() };
/** `companies/{id}` itself, read for the company's name. */
const mockCompanyGet = jest.fn();

jest.mock('../../firebaseAdmin', () => ({
  admin: {
    firestore: {
      FieldValue: { serverTimestamp: () => 'TS' },
      Timestamp: { now: () => ({ toMillis: () => 1000 }), fromMillis: (ms) => ({ toMillis: () => ms }) },
    },
  },
  db: {
    collection: (name) => (name === 'change_reviews'
      // No other open review to replace (changeReview.lifecycle.test.js covers that).
      ? { doc: () => mockReviewRef, where: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }) }
      : { doc: (id) => ({ get: () => mockCompanyGet(id), collection: () => ({ doc: () => mockAppRef }) }) }),
    batch: () => mockBatch,
    runTransaction: async (fn) => fn({ get: (query) => query.get(), set: (ref, data) => ref.set(data), update: jest.fn() }),
  },
}));

const {
  proposeApplicationChanges, createChangeReview, getChangeReview, submitChangeResolution,
} = require('../../applicationChanges');

const auth = { uid: 'admin1', token: { name: 'Rec' } };

beforeEach(() => {
  jest.resetAllMocks();
  mockAssert.mockResolvedValue(undefined);
  mockRateLimit.mockResolvedValue(true);
  mockBatch.commit.mockResolvedValue();
  mockAdd.mockResolvedValue();
  mockAppRef.set.mockResolvedValue();
  mockReviewRef.set.mockResolvedValue();
  mockCompanyGet.mockResolvedValue({ exists: true, data: () => ({ companyName: 'Acme Freight' }) });
  mockState.appSnap = { exists: true, data: () => ({ firstName: 'John', lastName: 'Doe' }) };
  mockState.pendingEmpty = true; mockState.pendingSize = 0; mockState.pendingDocs = [];
  mockState.reviewSnap = { exists: true, data: () => ({ companyId: 'co1', applicationId: 'app1', collectionName: 'applications', applicantName: 'John Doe', expiresAt: { toMillis: () => Date.now() + 1e9 }, status: 'open' }) };
});

const target = { companyId: 'co1', applicationId: 'app1', collectionName: 'applications' };
/** When a pending change was last written, as its snapshot reports it (`updateTime`). */
const READ_AT = { seconds: 1700000000, nanoseconds: 0 };

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
    // Every field left out, in the order sent: the dossier names each one in its
    // message, telling "no change" from "not editable" by the shared list.
    expect(res.skipped).toEqual(['lastName', 'status', 'cdl-front']);
    // one pending_changes doc + the app-doc flag both written in the batch
    expect(mockBatch.set).toHaveBeenCalledTimes(2);
    expect(mockBatch.commit).toHaveBeenCalled();
    const flagCall = mockBatch.set.mock.calls.find((c) => c[1] && c[1].hasPendingCompanyChanges === true);
    expect(flagCall).toBeTruthy();
  });

  it('writes nothing when every field is outside the shared list, and names each one', async () => {
    const res = await proposeApplicationChanges({ auth, data: { ...target, changes: [
      { fieldKey: 'sms-consent', proposedValue: 'yes' },
      { fieldKey: 'military-service', proposedValue: 'no' },
    ] } });
    expect(res).toMatchObject({ success: true, applied: [], skipped: ['sms-consent', 'military-service'] });
    expect(mockBatch.set).not.toHaveBeenCalled();
    expect(mockBatch.commit).not.toHaveBeenCalled();
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

  // The page names who proposed the changes, from the company the review belongs to.
  it("names the review's company, from the company record", async () => {
    mockCompanyGet.mockResolvedValue({ exists: true, data: () => ({ companyName: '  Acme Freight ' }) });
    const res = await getChangeReview({ data: { token: 't' } });
    expect(mockCompanyGet).toHaveBeenCalledWith('co1');
    expect(res.companyName).toBe('Acme Freight');
  });

  it('names the company on a completed review too', async () => {
    mockState.reviewSnap = { exists: true, data: () => ({ companyId: 'co1', applicantName: 'John Doe', status: 'completed', expiresAt: { toMillis: () => Date.now() + 1e9 } }) };
    const res = await getChangeReview({ data: { token: 't' } });
    expect(res).toEqual({ applicantName: 'John Doe', status: 'completed', changes: [], companyName: 'Acme Freight' });
  });

  it.each([
    ['the company record is gone', { exists: false, data: () => undefined }],
    ['the company has no name', { exists: true, data: () => ({ companyName: '   ' }) }],
    ['the name is not text', { exists: true, data: () => ({ companyName: { en: 'Acme' } }) }],
  ])('names no company when %s', async (_label, snap) => {
    mockCompanyGet.mockResolvedValue(snap);
    const res = await getChangeReview({ data: { token: 't' } });
    expect(res.companyName).toBeNull();
  });

  it('still opens the review when the company record cannot be read', async () => {
    mockCompanyGet.mockRejectedValue(new Error('unavailable'));
    mockState.pendingDocs = [{ id: 'firstName', data: () => ({ fieldKey: 'firstName', originalValue: 'John', proposedValue: 'Jonathan', status: 'pending' }) }];
    const res = await getChangeReview({ data: { token: 't' } });
    expect(res.companyName).toBeNull();
    expect(res.changes).toHaveLength(1);
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
 * A decision applies to the value the driver was shown.
 *
 * A new proposal replaces a pending change's `proposedValue` while a review page
 * is open, so the page sends the value it showed with each decision (`shown`),
 * and the server refuses the whole call when any of them is no longer the
 * pending one. A page that sends no `shown` (the Production page, until a
 * release is promoted) keeps today's behaviour.
 */
describe('submitChangeResolution checks the value the driver saw', () => {
  const EMPLOYERS = [
    { employerId: 'aaaaaaaaaaaa', companyName: 'ABC Trucking', verification: { status: 'Completed', history: [{ at: 1, note: 'sent' }] } },
  ];

  beforeEach(() => {
    mockState.pendingDocs = [
      // The company re-proposed First Name after the page loaded 'Jonathan'.
      { id: 'firstName', data: () => ({ fieldKey: 'firstName', originalValue: 'John', proposedValue: 'Jon', status: 'pending' }) },
      { id: 'city', data: () => ({ fieldKey: 'city', originalValue: 'Reno', proposedValue: 'Sparks', status: 'pending' }) },
      { id: 'phone', data: () => ({ fieldKey: 'phone', originalValue: '1', proposedValue: '2', status: 'approved' }) },
      { id: 'employers', data: () => ({ fieldKey: 'employers', originalValue: [], proposedValue: EMPLOYERS, status: 'pending' }) },
    ];
    mockState.appSnap = { exists: true, data: () => ({ employers: EMPLOYERS }) };
  });

  const refusal = (resolutions) => submitChangeResolution({ data: { token: 't', resolutions } }).then(
    () => { throw new Error('expected a refusal'); },
    (e) => e,
  );

  it('refuses the whole call, writing nothing, when a value changed after the page opened', async () => {
    const e = await refusal([
      { fieldKey: 'city', action: 'approve', shown: 'Sparks' },
      { fieldKey: 'firstName', action: 'approve', shown: 'Jonathan' },
    ]);

    expect(e.code).toBe('failed-precondition');
    expect(e.details).toEqual({ reason: 'changes-updated' });
    expect(e.message).toBe('Some of these changes were updated after you opened this page. Please review them again.');
    // Not one of the words the page reads as a link that stopped working.
    expect(e.message).not.toMatch(/replaced|newer|expired|already/i);
    expect(mockBatch.set).not.toHaveBeenCalled();
    expect(mockBatch.commit).not.toHaveBeenCalled();
    expect(mockAppRef.set).not.toHaveBeenCalled();
    expect(mockReviewRef.set).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it.each(['approve', 'reject', 'edit'])('refuses a %s of a value the driver did not see', async (action) => {
    const e = await refusal([{ fieldKey: 'firstName', action, shown: 'Jonathan', value: 'Johnny' }]);
    expect(e.details).toEqual({ reason: 'changes-updated' });
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });

  it('refuses a decision on a change that is no longer pending', async () => {
    const e = await refusal([
      { fieldKey: 'city', action: 'approve', shown: 'Sparks' },
      { fieldKey: 'phone', action: 'approve', shown: '2' },
    ]);
    expect(e.details).toEqual({ reason: 'changes-updated' });
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });

  it('refuses a decision on a change that is gone', async () => {
    const e = await refusal([{ fieldKey: 'lastName', action: 'approve', shown: 'Doer' }]);
    expect(e.details).toEqual({ reason: 'changes-updated' });
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });

  it('records the decisions when every value is the one shown, whatever order its keys came in', async () => {
    // The employer list as the page sent it back: same rows, keys in another order.
    const shownEmployers = [{
      verification: { history: [{ note: 'sent', at: 1 }], status: 'Completed' },
      companyName: 'ABC Trucking',
      employerId: 'aaaaaaaaaaaa',
    }];
    await submitChangeResolution({ data: { token: 't', resolutions: [
      { fieldKey: 'firstName', action: 'approve', shown: 'Jon' },
      { fieldKey: 'city', action: 'reject', shown: 'Sparks' },
      { fieldKey: 'employers', action: 'approve', shown: shownEmployers },
    ] } });

    const docUpdate = mockBatch.set.mock.calls.find(([ref]) => ref === mockAppRef);
    expect(docUpdate[1]).toMatchObject({ firstName: 'Jon', employers: [expect.objectContaining({ employerId: 'aaaaaaaaaaaa' })] });
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('compares a cleared value as null', async () => {
    mockState.pendingDocs = [{ id: 'middleName', data: () => ({ fieldKey: 'middleName', originalValue: 'Q', proposedValue: null, status: 'pending' }) }];
    await submitChangeResolution({ data: { token: 't', resolutions: [{ fieldKey: 'middleName', action: 'approve', shown: null }] } });
    expect(mockBatch.set.mock.calls.find(([ref]) => ref === mockAppRef)[1]).toEqual({ middleName: null });
  });

  it('writes each decision only onto the change as it was read', async () => {
    mockState.pendingDocs = mockState.pendingDocs.map((d) => ({ ...d, updateTime: READ_AT }));
    await submitChangeResolution({ data: { token: 't', resolutions: [
      { fieldKey: 'firstName', action: 'approve', shown: 'Jon' },
      { fieldKey: 'city', action: 'reject', shown: 'Sparks' },
    ] } });

    expect(mockBatch.update).toHaveBeenCalledWith(
      { __pc: 'firstName' }, expect.objectContaining({ status: 'approved', resolvedValue: 'Jon' }), { lastUpdateTime: READ_AT },
    );
    expect(mockBatch.update).toHaveBeenCalledWith(
      { __pc: 'city' }, expect.objectContaining({ status: 'rejected', resolvedValue: 'Reno' }), { lastUpdateTime: READ_AT },
    );
  });

  it('refuses the call when a proposal lands between the check and the write', async () => {
    // Firestore refuses the batch: a change was written after it was read.
    mockBatch.commit.mockRejectedValueOnce(Object.assign(new Error('FAILED_PRECONDITION'), { code: 9 }));
    const e = await refusal([{ fieldKey: 'firstName', action: 'approve', shown: 'Jon' }]);

    expect(e.code).toBe('failed-precondition');
    expect(e.details).toEqual({ reason: 'changes-updated' });
    // Nothing after the batch ran: the review stays open, nothing is logged as decided.
    expect(mockReviewRef.set).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('passes on any other failure to record the decisions', async () => {
    mockBatch.commit.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 14 }));
    const e = await refusal([{ fieldKey: 'firstName', action: 'approve', shown: 'Jon' }]);
    expect(e.code).toBe(14);
  });

  it('keeps the old behaviour for a page that sends no shown value', async () => {
    const res = await submitChangeResolution({ data: { token: 't', resolutions: [
      { fieldKey: 'firstName', action: 'approve' },
      { fieldKey: 'phone', action: 'approve' },
    ] } });

    // The pending value as it stands now; the settled change is skipped, as before.
    expect(mockBatch.set.mock.calls.find(([ref]) => ref === mockAppRef)[1]).toEqual({ firstName: 'Jon' });
    expect([...mockBatch.set.mock.calls, ...mockBatch.update.mock.calls].some(([ref]) => ref.__pc === 'phone')).toBe(false);
    expect(res.success).toBe(true);
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
    updateTime: READ_AT,
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
    expect(mockBatch.update).toHaveBeenCalledWith(
      { __pc: 'employers' },
      expect.objectContaining({ status: 'rejected' }),
      { lastUpdateTime: READ_AT },
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

    const written = [...mockBatch.set.mock.calls, ...mockBatch.update.mock.calls]
      .map(([ref]) => (ref.__pc ? `pending_changes/${ref.__pc}` : 'application'));
    expect(written.every((path) => path === 'application' || path.startsWith('pending_changes/'))).toBe(true);
    expect(mockAdd.mock.calls.every(([row]) => typeof row.action === 'string')).toBe(true);
  });
});
