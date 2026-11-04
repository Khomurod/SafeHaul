/**
 * PEV — at day 30 with no answer, the record of attempts is stored beside the
 * request's PDF, linked from the row's no-response entry and filed once in the
 * DQ file. A failure there never stops the day-30 job.
 *
 * The real pdf-lib renders the record here (the other PEV suites stub it).
 * `employmentVerification.support.js` holds the harness. No test here queues a
 * `*Once` value, so the harness's `clearAllMocks` reset is the right one.
 */

jest.mock('firebase-functions/v2/https', () => require('./employmentVerification.support').httpsV2Mock());
jest.mock('firebase-functions/v2/scheduler', () => require('./employmentVerification.support').schedulerMock());
jest.mock('firebase-functions', () => require('./employmentVerification.support').functionsMock());
jest.mock('../../emailService', () => require('./employmentVerification.support').emailServiceMock());
jest.mock('../../shared/rateLimiter', () => require('./employmentVerification.support').rateLimiterMock());
jest.mock('../../shared/companyAccess', () => require('./employmentVerification.support').companyAccessMock());
jest.mock('uuid', () => require('./employmentVerification.support').uuidMock());
jest.mock('../../firebaseAdmin', () => require('./employmentVerification.support').firebaseAdminMock());

const {
  appKey, applicationDocs, createTs, dqFileDocs, notificationDocs, savedStoragePaths, verificationDocs,
  failNextDqFiling, failNextStorageSave, mockSendDynamicEmail, resetPevState,
} = require('./employmentVerification.support');

const { processVerificationReminders } = require('../../employmentVerification');

const DAY = 24 * 60 * 60 * 1000;
const APP = appKey('co-1', 'applications', 'app-1');
const TOKEN = 'portal-token-0123456789abcdef';
const NO_RESPONSE = 'No Response (Good Faith Documented)';
const RECORD_PATH = 'companies/co-1/applications/app-1/pev_requests/PEV_ATTEMPTS_Old_Carrier_req-1234.pdf';
const DQ_KEY = `${APP}/pev_attempts_req-12345678`;

function seed({ verification = { status: 'Sent', history: [{ action: 'Sent via Portal' }] }, ...rest } = {}) {
  applicationDocs.set(APP, { employers: [{ companyName: 'Old Carrier', employerId: 'aaaaaaaaaaaa', verification }] });
  verificationDocs.set(TOKEN, {
    token: TOKEN,
    requestId: 'req-12345678',
    status: 'reminder_sent',
    companyId: 'co-1',
    collectionName: 'applications',
    applicationId: 'app-1',
    employerIndex: 0,
    employerId: 'aaaaaaaaaaaa',
    employerName: 'Old Carrier',
    employerEmail: 'hr@oldcarrier.test',
    applicantName: 'Jane Driver',
    companyName: 'SafeHaul Carrier',
    deliveryMethod: 'email',
    reminderCount: 3,
    createdBy: 'recruiter-1',
    attempts: [{ kind: 'sent', at: createTs(Date.now() - 31 * DAY), ok: true, by: 'recruiter-1', method: 'email' }],
    createdAt: createTs(Date.now() - 31 * DAY),
    expiresAt: createTs(Date.now() - DAY),
    ...rest,
  });
}

const row = () => applicationDocs.get(APP).employers[0].verification;
const carrierEmails = () => mockSendDynamicEmail.mock.calls.filter(([, to]) => to === 'ops@safehaul.test');

beforeEach(resetPevState);

describe('the record of attempts at day 30', () => {
  it('is stored beside the request PDF, linked from the row and filed once in the DQ file', async () => {
    seed();

    await processVerificationReminders();

    expect(verificationDocs.get(TOKEN)).toMatchObject({ status: 'no_response', attemptRecordPath: RECORD_PATH });
    expect(savedStoragePaths).toEqual([RECORD_PATH]);
    expect(row().status).toBe(NO_RESPONSE);
    expect(row().history.at(-1)).toMatchObject({ action: NO_RESPONSE, attemptRecordPath: RECORD_PATH });
    expect(dqFileDocs.get(DQ_KEY)).toMatchObject({
      type: 'pev_attempts',
      fileType: 'PEV Attempt Record – Old Carrier',
      label: 'PEV Attempt Record',
      fileName: 'Verification-Attempts-Jane-Driver.pdf',
      storagePath: RECORD_PATH,
      url: null,
      isSynced: true,
    });
    // The bell and the carrier's email are unchanged.
    expect(notificationDocs.get('co-1/pev_no_response_req-12345678')).toBeDefined();
    expect(carrierEmails()).toHaveLength(1);
  });

  it('never names the request by its token', async () => {
    seed({ requestId: undefined });

    await processVerificationReminders();

    const written = JSON.stringify([savedStoragePaths, [...dqFileDocs.entries()], row(), verificationDocs.get(TOKEN).attemptRecordPath]);
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain(TOKEN.slice(0, 8));
    expect([...dqFileDocs.keys()]).toEqual([expect.stringMatching(new RegExp(`^${APP}/pev_attempts_[0-9a-f]{32}$`))]);
  });

  it('does not stop the job when the DQ file cannot take it', async () => {
    seed();
    failNextDqFiling();

    await processVerificationReminders();

    expect(verificationDocs.get(TOKEN).status).toBe('no_response');
    expect(dqFileDocs.size).toBe(0);
    expect(row().history.at(-1)).toMatchObject({ action: NO_RESPONSE, attemptRecordPath: RECORD_PATH });
    expect(carrierEmails()).toHaveLength(1);
  });

  it('does not stop the job when the PDF cannot be stored', async () => {
    seed();
    failNextStorageSave();

    await processVerificationReminders();

    expect(verificationDocs.get(TOKEN).status).toBe('no_response');
    expect(verificationDocs.get(TOKEN).attemptRecordPath).toBeUndefined();
    expect(dqFileDocs.size).toBe(0);
    expect(row().history.at(-1)).toEqual(expect.not.objectContaining({ attemptRecordPath: expect.anything() }));
    expect(carrierEmails()).toHaveLength(1);
  });

  it('is filed before the carrier email, so a mail failure cannot lose it', async () => {
    seed();
    mockSendDynamicEmail.mockRejectedValue(new Error('SMTP down'));

    await processVerificationReminders();

    expect(dqFileDocs.get(DQ_KEY)).toBeDefined();
  });

  it('is not made for a row that already holds the result', async () => {
    seed({ verification: { status: 'Completed', resultUrl: 'companies/co-1/applications/app-1/pev_results/x.pdf', history: [] } });

    await processVerificationReminders();

    expect(savedStoragePaths).toEqual([]);
    expect(dqFileDocs.size).toBe(0);
  });

  it('is not made for a record deleted since the request went out', async () => {
    seed();
    applicationDocs.delete(APP);

    await processVerificationReminders();

    expect(verificationDocs.get(TOKEN).status).toBe('no_response');
    expect(savedStoragePaths).toEqual([]);
    expect(dqFileDocs.size).toBe(0);
  });
});
