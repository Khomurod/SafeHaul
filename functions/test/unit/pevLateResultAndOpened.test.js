/**
 * PEV — a late answer still counts, and the team sees that the employer opened
 * the link.
 *
 * - "Upload Result" after the day-30 "no response" mark completes the request;
 *   the mark stays in the row's history.
 * - The first time the employer opens the link, the server copies that time
 *   onto the employer row, once: the team cannot read the request itself.
 *
 * `employmentVerification.support.js` holds the harness.
 */

jest.mock('firebase-functions/v2/https', () => require('./employmentVerification.support').httpsV2Mock());
jest.mock('firebase-functions/v2/scheduler', () => require('./employmentVerification.support').schedulerMock());
jest.mock('firebase-functions', () => require('./employmentVerification.support').functionsMock());
jest.mock('../../emailService', () => require('./employmentVerification.support').emailServiceMock());
jest.mock('../../shared/rateLimiter', () => require('./employmentVerification.support').rateLimiterMock());
jest.mock('../../shared/companyAccess', () => require('./employmentVerification.support').companyAccessMock());
jest.mock('../../shared/randomId', () => require('./employmentVerification.support').randomIdMock());
jest.mock('pdf-lib', () => require('./employmentVerification.support').pdfLibMock());
jest.mock('../../firebaseAdmin', () => require('./employmentVerification.support').firebaseAdminMock());

const {
  appKey, applicationDocs, createTs, uploadedObjects, verificationDocs, resetPevState,
} = require('./employmentVerification.support');

const { getVerificationRequest, recordManualVerificationResult } = require('../../employmentVerification');

const DAY = 24 * 60 * 60 * 1000;
const APP = appKey('co-1', 'applications', 'app-1');
const TOKEN = 'portal-token-0123456789abcdef';
const RESULT_PATH = 'companies/co-1/applications/app-1/pev_results/1700000000000_late-fax.pdf';
const NO_RESPONSE = 'No Response (Good Faith Documented)';

function seed({ daysAgo = 2, verification = { status: 'Sent', history: [{ action: 'Sent via Portal' }] }, ...rest } = {}) {
  verificationDocs.set(TOKEN, {
    token: TOKEN,
    requestId: 'req-1',
    status: 'sent',
    companyId: 'co-1',
    collectionName: 'applications',
    applicationId: 'app-1',
    employerIndex: 0,
    employerId: 'aaaaaaaaaaaa',
    employerName: 'Old Carrier',
    applicantName: 'Jane Driver',
    companyName: 'SafeHaul Carrier',
    openedAt: null,
    createdAt: createTs(Date.now() - daysAgo * DAY),
    expiresAt: createTs(Date.now() + (30 - daysAgo) * DAY),
    ...rest,
  });
  applicationDocs.set(APP, {
    employers: [{ companyName: 'Old Carrier', employerId: 'aaaaaaaaaaaa', verification }],
  });
}

const row = () => applicationDocs.get(APP).employers[0].verification;
const open = () => getVerificationRequest({ data: { token: TOKEN } });

beforeEach(resetPevState);

describe('a late result', () => {
  it('can be uploaded after "no response", completing the request and keeping the mark in history', async () => {
    seed({
      daysAgo: 35,
      status: 'no_response',
      verification: { status: NO_RESPONSE, history: [{ action: 'Sent via Portal' }, { action: NO_RESPONSE }] },
    });
    uploadedObjects.add(RESULT_PATH);

    const result = await recordManualVerificationResult({
      auth: { uid: 'recruiter-1' },
      data: {
        companyId: 'co-1', applicationId: 'app-1', collectionName: 'applications',
        employerId: 'aaaaaaaaaaaa', employerIndex: 0, employerName: 'Old Carrier',
        storagePath: RESULT_PATH, fileName: 'late-fax.pdf',
      },
    });

    expect(result).toMatchObject({ success: true, closedRequests: 1 });
    expect(verificationDocs.get(TOKEN)).toMatchObject({ status: 'completed', completedBy: 'manual_result' });
    expect(row()).toMatchObject({ status: 'Completed', resultUrl: RESULT_PATH });
    expect(row().history.map((entry) => entry.action)).toEqual(['Sent via Portal', NO_RESPONSE, 'Result Uploaded']);
  });
});

describe('the employer opening the link', () => {
  it('is copied onto the employer row the first time', async () => {
    seed();

    const result = await open();

    expect(result.status).toBe('pending');
    expect(verificationDocs.get(TOKEN).status).toBe('opened');
    expect(row().openedAt).toEqual(expect.stringMatching(/^\d{4}-\d\d-\d\dT/));
    expect(row().history.at(-1)).toEqual({ action: 'Employer opened the link', timestamp: row().openedAt });
    expect(row().status).toBe('Sent');
  });

  it('keeps the first open, on the request and on the row, after a reminder and another open', async () => {
    seed();
    await open();
    const firstOnRow = row().openedAt;
    // The server's clock filled in the first open; a reminder then went out.
    verificationDocs.set(TOKEN, { ...verificationDocs.get(TOKEN), openedAt: createTs(1700000000000), status: 'reminder_sent' });

    await open();

    expect(verificationDocs.get(TOKEN).openedAt.toMillis()).toBe(1700000000000);
    expect(verificationDocs.get(TOKEN).status).toBe('opened');
    expect(row().openedAt).toBe(firstOnRow);
    expect(row().history.filter((entry) => entry.action === 'Employer opened the link')).toHaveLength(1);
  });

  it('copies nothing for a request opened before the row kept it', async () => {
    seed({ status: 'reminder_sent', openedAt: createTs(1700000000000) });
    await open();
    expect(row().openedAt).toBeUndefined();
    expect(row().history).toEqual([{ action: 'Sent via Portal' }]);
  });

  it('still shows the form when the employer is no longer on the application', async () => {
    seed();
    applicationDocs.set(APP, { employers: [] });
    await expect(open()).resolves.toMatchObject({ status: 'pending' });
  });
});
