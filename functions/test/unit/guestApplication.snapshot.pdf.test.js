/**
 * Preserving the application PDF at submission, and a repeating section.
 *
 * Part of the guest-application snapshot suite. The in-memory Firestore, the
 * fixtures and the reset are in `guestApplication.snapshot.support.js`. Each
 * `jest.mock` below has to stay in this file, because Jest hoists it per file
 * and cannot register one from a helper.
 */
jest.mock('firebase-functions/v1', () => require('./guestApplication.snapshot.support').httpsMock());
jest.mock('firebase-admin/firestore', () => require('./guestApplication.snapshot.support').firestoreFieldValueMock());
jest.mock('../../firebaseAdmin', () => require('./guestApplication.snapshot.support').firebaseAdminMock());
jest.mock('../../shared/companyTenant', () => require('./guestApplication.snapshot.support').companyTenantMock());
jest.mock('../../shared/rateLimiter', () => require('./guestApplication.snapshot.support').rateLimiterMock());

const {
   decodeStoredSnapshot, findNestedArrayPaths,
} = require('../../shared/submissionSnapshotStorage');
const { submitGuestApplication } = require('../../guestApplication');
const {
   mockState, payload, ctx, storedSnapshots, onlySnapshot, resetSnapshotState,
} = require('./guestApplication.snapshot.support');

beforeEach(resetSnapshotState);

describe('preserving the application PDF at submission', () => {
  const submit = (formData = {}) => submitGuestApplication(payload(formData), { rawRequest: { ip: '203.0.113.9' } });
  const applicationDoc = () => Object.values(mockState.applications)[0];

  it('stores an original alongside the snapshot, and files it as a DQ document', async () => {
    await submit();

    const paths = Object.keys(mockState.storedPdfs);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^application_originals\/co1\/.+\/v1\.pdf$/);
    expect(mockState.storedPdfs[paths[0]].buffer.length).toBeGreaterThan(1000);

    const dq = Object.values(mockState.dqFiles);
    expect(dq).toHaveLength(1);
    expect(dq[0].fileType).toBe('Application for Employment');
    expect(dq[0].url).toBeNull();
    expect(dq[0].requiresAuditedAccess).toBe(true);

    expect(applicationDoc().submissionRecord.pdfPreserved).toBe(true);
  });

  it('renders a redelivery from the STORED snapshot, not a freshly rebuilt one', async () => {
    // The redelivery arrives with the same attempt id, so the snapshot writer
    // returns the existing record. Rendering the in-memory rebuild would stamp a
    // different submission time — and could pick up company or question changes
    // made since — so the preserved PDF would not be the application it claims
    // to represent.
    await submit({ submissionAttemptId: 'attempt-1' });
    const storedPath = Object.keys(mockState.storedPdfs)[0];
    const firstBytes = mockState.storedPdfs[storedPath].buffer;

    // Between the two deliveries the company renames itself. The stored record
    // still says what it said.
    mockState.publicProfile = {
      companyName: 'Renamed Carrier LLC',
      applicationConfig: {
        cdlUpload: { hidden: false, required: false },
        medCardUpload: { hidden: false, required: false },
      },
      customQuestions: [],
    };

    await submit({ submissionAttemptId: 'attempt-1' });

    expect(Object.keys(mockState.storedPdfs)).toHaveLength(1);
    expect(mockState.storedPdfs[storedPath].buffer).toBe(firstBytes);
    // One preserved record, one preserved document, no second "original".
    expect(Object.keys(mockState.snapshots)).toHaveLength(1);
  });

  it('keeps the application when preserving the PDF fails', async () => {
    const bucket = require('../../firebaseAdmin').storage.bucket;
    const spy = jest.spyOn(require('../../firebaseAdmin').storage, 'bucket').mockImplementation(() => ({
      file: () => ({
        exists: async () => [false],
        save: async () => { throw new Error('storage unavailable'); },
      }),
    }));

    const result = await submit();

    expect(result.applicationId).toBeTruthy();
    expect(applicationDoc().submissionRecord.status).toBe('recorded');
    expect(applicationDoc().submissionRecord.pdfPreserved).toBe(false);
    spy.mockRestore();
    expect(typeof bucket).toBe('function');
  });
});

// A driver who lists an employer or a previous address is the normal case, not an
// edge case — a DOT application asks for both. Their answers are rows of cells,
// an array of arrays, and Firestore refuses to store an array inside an array.
//
// Every such submission therefore saved the application, failed to write the
// immutable record, failed to preserve the official PDF, and reported success to
// the driver, because guestApplication catches a snapshot failure by design so a
// storage problem cannot cost someone their application. The result was a silent,
// permanent evidentiary gap. No test caught it: none had ever filled in a
// repeating section.

describe('a driver who fills in a repeating section still gets a record and a PDF', () => {
  const WITH_HISTORY = {
    employers: [
      { companyName: 'Cascade Haulage', position: 'Driver', startDate: '2019-04', endDate: '2021-06' },
      { companyName: 'Rimrock Transport', position: 'Driver', startDate: '2021-07', endDate: '2023-02' },
    ],
    previousAddresses: [{ street: '1 Depot Road', city: 'Boise', state: 'ID', zip: '83702' }],
    accidents: [{ date: '2020-08-14', city: 'Ogden', state: 'UT', commercial: 'Yes' }],
  };

  it('writes the immutable record instead of failing the snapshot', async () => {
    const res = await submitGuestApplication(payload(WITH_HISTORY), ctx);

    expect(res.success).toBe(true);
    // A null snapshotId is precisely the silent failure this covers.
    expect(res.snapshotId).toBe('v1');
    expect(storedSnapshots()).toHaveLength(1);
  });

  it('stores a record Firestore will accept', async () => {
    await submitGuestApplication(payload(WITH_HISTORY), ctx);
    expect(findNestedArrayPaths(onlySnapshot())).toEqual([]);
  });

  it('preserves the official PDF', async () => {
    await submitGuestApplication(payload(WITH_HISTORY), ctx);
    expect(Object.keys(mockState.storedPdfs)).toHaveLength(1);
  });

  it('records the answers the driver actually gave, in order', async () => {
    await submitGuestApplication(payload(WITH_HISTORY), ctx);

    const employers = decodeStoredSnapshot(onlySnapshot())
      .sections.flatMap((section) => section.answers)
      .find((answer) => answer.fieldId === 'employers');

    expect(employers.rows).toHaveLength(2);
    expect(employers.rows.map((row) => row.find((cell) => cell.label === 'Employer').displayValue))
      .toEqual(['Cascade Haulage', 'Rimrock Transport']);
  });

  it('does not stamp a failed record status', async () => {
    await submitGuestApplication(payload(WITH_HISTORY), ctx);
    const app = Object.values(mockState.applications)[0];
    expect(app.submissionRecord.status).not.toBe('failed');
  });
});
