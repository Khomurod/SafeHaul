/**
 * A submission answers within the function's time, with the application filed
 * and its unfinished draft gone, even when the application PDF is slow.
 *
 * Part of the guest-application snapshot suite: the in-memory Firestore, the
 * fixtures and the reset are in `guestApplication.snapshot.support.js`, and each
 * `jest.mock` stays in this file because Jest hoists it per file.
 */
jest.mock('firebase-functions/v1', () => require('./guestApplication.snapshot.support').httpsMock());
jest.mock('firebase-admin/firestore', () => require('./guestApplication.snapshot.support').firestoreFieldValueMock());
jest.mock('../../firebaseAdmin', () => require('./guestApplication.snapshot.support').firebaseAdminMock());
jest.mock('../../shared/companyTenant', () => require('./guestApplication.snapshot.support').companyTenantMock());
jest.mock('../../shared/rateLimiter', () => require('./guestApplication.snapshot.support').rateLimiterMock());

const { storage } = require('../../firebaseAdmin');
const { submitGuestApplication } = require('../../guestApplication');
const { mockState, payload, ctx, resetSnapshotState } = require('./guestApplication.snapshot.support');

beforeEach(resetSnapshotState);
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const applicationDoc = () => Object.values(mockState.applications)[0];

/** Storage that takes the PDF and does not answer until the test lets it. */
function slowPdfStorage() {
  let answer;
  const held = new Promise((resolve) => { answer = resolve; });
  const saves = [];
  jest.spyOn(storage, 'bucket').mockImplementation(() => ({
    file: (path) => ({
      exists: async () => [false],
      getMetadata: async () => [{}],
      save: () => {
        saves.push({ path, draftsDeletedBefore: [...mockState.draftsDeleted] });
        return held;
      },
    }),
  }));
  return { saves, answer };
}

/**
 * Lets the PDF be drawn until Storage is asked to keep it. The drawing takes turns
 * of the event loop, and pdf-lib waits on timers of its own, which are fake here.
 */
async function untilSaving(pdf) {
  for (let turn = 0; turn < 1000 && pdf.saves.length === 0; turn += 1) {
    await new Promise((resolve) => { setImmediate(resolve); });
    await jest.advanceTimersByTimeAsync(1);
  }
  expect(pdf.saves).toHaveLength(1);
}

describe('a slow application PDF', () => {
  it('does not keep the driver from their confirmation number', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const pdf = slowPdfStorage();

    const answered = submitGuestApplication(payload(), ctx);
    await untilSaving(pdf);
    await jest.advanceTimersByTimeAsync(15000);
    const result = await answered;

    expect(result.applicationId).toBeTruthy();
    expect(result.confirmationNumber).toBeTruthy();
    expect(applicationDoc().submissionRecord).toMatchObject({ status: 'recorded', pdfPreserved: false });
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('Preserving the application PDF failed'),
      expect.objectContaining({ code: 'step-timeout' }),
    );
    pdf.answer();
  });

  it('cannot leave the company an unfinished copy: the draft goes before the PDF', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const pdf = slowPdfStorage();

    const answered = submitGuestApplication(payload(), ctx);
    await untilSaving(pdf);
    await jest.advanceTimersByTimeAsync(15000);
    const result = await answered;

    expect(pdf.saves[0].draftsDeletedBefore).toEqual([`co1/${result.applicationId}`]);
    pdf.answer();
  });
});

describe('an ordinary submission', () => {
  it('deletes the draft once, and preserves the PDF', async () => {
    const result = await submitGuestApplication(payload(), ctx);
    expect(mockState.draftsDeleted).toEqual([`co1/${result.applicationId}`]);
    expect(applicationDoc().submissionRecord.pdfPreserved).toBe(true);
  });
});
