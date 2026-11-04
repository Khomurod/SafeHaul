/**
 * PEV — which requests stay live: a request whose first email failed, one the
 * company completed by uploading the result, and one a resend replaced are out
 * of the reminder cycle and never marked "no response".
 *
 * `employmentVerification.support.js` holds the harness; the `jest.mock` lines
 * stay here because Jest hoists them per file.
 */

jest.mock('firebase-functions/v2/https', () => require('./employmentVerification.support').httpsV2Mock());
jest.mock('firebase-functions/v2/scheduler', () => require('./employmentVerification.support').schedulerMock());
jest.mock('firebase-functions', () => require('./employmentVerification.support').functionsMock());
jest.mock('../../emailService', () => require('./employmentVerification.support').emailServiceMock());
jest.mock('../../shared/rateLimiter', () => require('./employmentVerification.support').rateLimiterMock());
jest.mock('../../shared/companyAccess', () => require('./employmentVerification.support').companyAccessMock());
jest.mock('uuid', () => require('./employmentVerification.support').uuidMock());
jest.mock('pdf-lib', () => require('./employmentVerification.support').pdfLibMock());
jest.mock('../../firebaseAdmin', () => require('./employmentVerification.support').firebaseAdminMock());

const {
  appKey, applicationDocs, createTs, responseDocs, uploadedObjects, verificationDocs,
  mockAssertCompanyAccessForRequest, mockSendDynamicEmail, resetPevState,
} = require('./employmentVerification.support');

const {
  getVerificationRequest,
  processVerificationReminders,
  recordManualVerificationResult,
  sendVerificationRequest,
  submitVerificationResponse,
} = require('../../employmentVerification');

const DAY = 24 * 60 * 60 * 1000;
const APP = appKey('co-1', 'applications', 'app-1');
const OLD_CARRIER = 'aaaaaaaaaaaa';
const OTHER_CARRIER = 'bbbbbbbbbbbb';
const RESULT_PATH = 'companies/co-1/applications/app-1/pev_results/1700000000000_fax.pdf';

/** A request filed against an employer of app-1, `daysAgo` days old. */
function seedRequest(token, { daysAgo = 0, status = 'sent', employerId = OLD_CARRIER, ...rest } = {}) {
  verificationDocs.set(token, {
    token,
    status,
    companyId: 'co-1',
    collectionName: 'applications',
    applicationId: 'app-1',
    employerIndex: 0,
    employerId,
    employerName: 'Old Carrier',
    employerEmail: 'hr@oldcarrier.test',
    applicantName: 'Jane Driver',
    companyName: 'SafeHaul Carrier',
    employmentStartDate: '2021-01',
    employmentEndDate: '2024-01',
    reminderCount: 0,
    createdAt: createTs(Date.now() - daysAgo * DAY),
    expiresAt: createTs(Date.now() + (30 - daysAgo) * DAY),
    ...rest,
  });
}

function seedApplication(verification = { status: 'Sent', history: [] }) {
  applicationDocs.set(APP, {
    employers: [
      { companyName: 'Old Carrier', employerId: OLD_CARRIER, verification },
      { companyName: 'Other Carrier', employerId: OTHER_CARRIER, verification: { status: 'Sent', history: [] } },
    ],
  });
}

const row = (index = 0) => applicationDocs.get(APP).employers[index];

const sendTo = (overrides = {}) => sendVerificationRequest({
  auth: { uid: 'recruiter-1' },
  data: {
    companyId: 'co-1', applicationId: 'app-1', employerIndex: 0, employerId: OLD_CARRIER,
    applicantName: 'Jane Driver', employerName: 'Old Carrier',
    employerEmail: 'hr@oldcarrier.test', deliveryMethod: 'email',
    ...overrides,
  },
});

const uploadResult = (overrides = {}) => recordManualVerificationResult({
  auth: { uid: 'recruiter-1' },
  data: {
    companyId: 'co-1', applicationId: 'app-1', collectionName: 'applications',
    employerId: OLD_CARRIER, employerIndex: 0, employerName: 'Old Carrier',
    storagePath: RESULT_PATH, fileName: 'fax.pdf',
    ...overrides,
  },
});

/** Moves a stored request `days` into the past, as the daily job will see it. */
function age(token, days) {
  const stored = verificationDocs.get(token);
  verificationDocs.set(token, { ...stored, createdAt: createTs(Date.now() - days * DAY) });
}

const emailsTo = (address) => mockSendDynamicEmail.mock.calls.filter(([, to]) => to === address);

beforeEach(resetPevState);

describe('a request whose first email did not go out', () => {
  it('is marked not sent, and is never reminded nor marked "no response"', async () => {
    seedApplication({ status: 'Not Started', history: [] });
    mockSendDynamicEmail.mockRejectedValue(new Error('Failed to send email: Missing email configuration'));

    const result = await sendTo();

    expect(result).toMatchObject({ success: false, error: 'the email to the employer could not be sent' });
    expect(verificationDocs.get('pev-token-123456')).toMatchObject({ status: 'send_failed' });

    mockSendDynamicEmail.mockResolvedValue({ success: true });
    for (const days of [6, 16, 21, 31]) {
      age('pev-token-123456', days);
      await processVerificationReminders();
    }

    expect(mockSendDynamicEmail).toHaveBeenCalledTimes(1);
    expect(verificationDocs.get('pev-token-123456').status).toBe('send_failed');
    expect(row().verification.status).toBe('Not Started');
    expect(row().verification.history).toEqual([]);
  });

  it('leaves the employer\'s earlier request live, since this one replaced nothing', async () => {
    seedApplication();
    seedRequest('earlier-token', { daysAgo: 3, status: 'opened' });
    mockSendDynamicEmail.mockRejectedValue(new Error('Failed to send email: SMTP down'));

    await sendTo();

    expect(verificationDocs.get('earlier-token').status).toBe('opened');
  });
});

describe('the daily job', () => {
  it('still reminds a request that went out, and marks it at day 30', async () => {
    seedApplication();
    seedRequest('live-token', { daysAgo: 6 });

    await processVerificationReminders();
    expect(verificationDocs.get('live-token')).toMatchObject({ status: 'reminder_sent', reminderCount: 1 });
    expect(emailsTo('hr@oldcarrier.test')).toHaveLength(1);

    age('live-token', 31);
    await processVerificationReminders();
    expect(verificationDocs.get('live-token').status).toBe('no_response');
    expect(row().verification.status).toBe('No Response (Good Faith Documented)');
  });

  it('never overwrites a Completed row with "no response"', async () => {
    // A result uploaded before uploads completed their request.
    seedApplication({ status: 'Completed', resultUrl: 'https://files.test/r.pdf', history: [{ action: 'Result Uploaded' }] });
    seedRequest('live-token', { daysAgo: 31, status: 'reminder_sent', reminderCount: 3 });

    await processVerificationReminders();

    expect(row().verification).toMatchObject({ status: 'Completed', resultUrl: 'https://files.test/r.pdf' });
    expect(row().verification.history).toEqual([{ action: 'Result Uploaded' }]);
    // The carrier is not told "no response" about a row that holds the result.
    expect(emailsTo('ops@safehaul.test')).toHaveLength(0);
  });

  it('does not put back into the cycle a request answered while its reminder was being sent', async () => {
    seedApplication();
    seedRequest('live-token', { daysAgo: 6 });
    mockSendDynamicEmail.mockImplementation(async () => {
      verificationDocs.set('live-token', { ...verificationDocs.get('live-token'), status: 'completed' });
      return { success: true };
    });

    await processVerificationReminders();

    expect(verificationDocs.get('live-token').status).toBe('completed');
  });
});

describe('Upload Result', () => {
  beforeEach(() => uploadedObjects.add(RESULT_PATH));

  it('completes the request: the row holds the file, reminders stop, day 30 leaves Completed', async () => {
    seedApplication({ status: 'Sent', method: 'Email', history: [{ action: 'Sent via Portal' }] });
    seedRequest('live-token', { daysAgo: 16, status: 'reminder_sent', reminderCount: 1 });
    seedRequest('other-employer', { daysAgo: 16, status: 'reminder_sent', reminderCount: 1, employerId: OTHER_CARRIER, employerIndex: 1, employerEmail: 'hr@other.test' });

    const result = await uploadResult();

    expect(result).toMatchObject({ success: true, closedRequests: 1 });
    expect(row().verification).toMatchObject({ status: 'Completed', resultUrl: RESULT_PATH });
    expect(row().verification.history.at(-1)).toMatchObject({ action: 'Result Uploaded', fileName: 'fax.pdf', url: RESULT_PATH });
    expect(result.verification).toEqual(row().verification);
    expect(verificationDocs.get('live-token')).toMatchObject({ status: 'completed', completedBy: 'manual_result' });
    // Another employer's request is not this result's.
    expect(verificationDocs.get('other-employer').status).toBe('reminder_sent');

    for (const days of [21, 31]) {
      age('live-token', days);
      await processVerificationReminders();
    }
    expect(emailsTo('hr@oldcarrier.test')).toHaveLength(0);
    expect(row().verification.status).toBe('Completed');
  });

  it('records a retried upload once', async () => {
    seedApplication();
    await uploadResult();
    await uploadResult();
    expect(row().verification.history.filter((entry) => entry.url === RESULT_PATH)).toHaveLength(1);
  });

  it('finds a request sent before employers had ids, by its index and name', async () => {
    applicationDocs.set(APP, { employers: [{ companyName: 'Old Carrier', verification: { status: 'Sent', history: [] } }] });
    seedRequest('legacy-token', { daysAgo: 6, employerId: null });

    await uploadResult({ employerId: null });

    expect(verificationDocs.get('legacy-token').status).toBe('completed');
    expect(row().verification.status).toBe('Completed');
  });

  it.each([
    ['another company', 'companies/co-2/applications/app-1/pev_results/x.pdf'],
    ['another record', 'companies/co-1/applications/app-2/pev_results/x.pdf'],
    ['another folder', 'companies/co-1/applications/app-1/dq_files/x.pdf'],
    ['a climb out of the folder', 'companies/co-1/applications/app-1/pev_results/../x.pdf'],
  ])('refuses a file in %s', async (_label, storagePath) => {
    seedApplication();
    await expect(uploadResult({ storagePath })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(row().verification.status).toBe('Sent');
  });

  it('records a file whose name holds two dots, which cannot leave the folder', async () => {
    seedApplication();
    const storagePath = 'companies/co-1/applications/app-1/pev_results/1700000000000_Smith v1..2.pdf';
    uploadedObjects.add(storagePath);

    await expect(uploadResult({ storagePath, fileName: 'Smith v1..2.pdf' })).resolves.toMatchObject({ success: true });
    expect(row().verification).toMatchObject({ status: 'Completed', resultUrl: storagePath });
  });

  it('refuses a file that was never uploaded', async () => {
    seedApplication();
    uploadedObjects.clear();
    await expect(uploadResult()).rejects.toMatchObject({ code: 'not-found' });
    expect(row().verification.status).toBe('Sent');
  });

  it('refuses a caller outside the company, before reading anything', async () => {
    seedApplication();
    mockAssertCompanyAccessForRequest.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await expect(uploadResult()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(row().verification.status).toBe('Sent');
  });

  it('refuses when the employer is no longer at that place on the application', async () => {
    applicationDocs.set(APP, { employers: [{ companyName: 'Someone Else' }] });
    await expect(uploadResult({ employerId: null })).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('Resend', () => {
  it('closes the employer\'s earlier live request, so it stops reminding and cannot mark the row', async () => {
    seedApplication();
    seedRequest('old-token', { daysAgo: 10, status: 'opened', reminderCount: 1 });
    seedRequest('other-employer', { daysAgo: 10, status: 'opened', reminderCount: 1, employerId: OTHER_CARRIER, employerIndex: 1, employerEmail: 'hr@other.test' });

    const result = await sendTo();

    expect(result.success).toBe(true);
    expect(verificationDocs.get('old-token')).toMatchObject({ status: 'superseded', supersededBy: 'pev-token-123456' });
    expect(verificationDocs.get('pev-token-123456').status).toBe('sent');
    expect(verificationDocs.get('other-employer').status).toBe('opened');

    mockSendDynamicEmail.mockClear();
    age('old-token', 31);
    await processVerificationReminders();
    expect(verificationDocs.get('old-token').status).toBe('superseded');
    expect(row().verification.status).toBe('Sent');
    expect(mockSendDynamicEmail).not.toHaveBeenCalled();
  });

  it('supersedes a request sent by hand too', async () => {
    seedApplication();
    seedRequest('old-token', { daysAgo: 2 });
    await sendTo({ deliveryMethod: 'fax', employerEmail: null });
    expect(verificationDocs.get('old-token').status).toBe('superseded');
  });

  it('leaves a completed or day-30 request as it was', async () => {
    seedApplication();
    seedRequest('done-token', { daysAgo: 40, status: 'completed' });
    seedRequest('nr-token', { daysAgo: 40, status: 'no_response' });
    await sendTo();
    expect(verificationDocs.get('done-token').status).toBe('completed');
    expect(verificationDocs.get('nr-token').status).toBe('no_response');
  });

  it('closes the old link in the portal, on opening and on submitting', async () => {
    seedRequest('old-token', { status: 'superseded' });

    await expect(getVerificationRequest({ data: { token: 'old-token' } }))
      .rejects.toMatchObject({ code: 'not-found', message: expect.stringMatching(/replaced by a newer one/) });
    await expect(submitVerificationResponse({
      data: {
        token: 'old-token',
        response: { respondentName: 'HR Lead', respondentTitle: 'HR', respondentPhone: '555-222-3333' },
      },
    })).rejects.toMatchObject({ code: 'not-found' });
    expect(responseDocs.size).toBe(0);
    expect(verificationDocs.get('old-token').status).toBe('superseded');
  });
});
