/**
 * PEV — the request keeps a record of every attempt to reach the employer.
 *
 * `verification_requests/{token}.attempts` is the authoritative log: the request
 * going out (or not), each reminder and whether it went out, the first open, the
 * answer, an uploaded result and the day-30 mark. The employer row gets a short
 * entry for the attempts nothing else mirrors: a failed first email and each
 * reminder. Neither ever holds the token or an address.
 *
 * `employmentVerification.support.js` holds the harness; the `jest.mock` lines
 * stay here because Jest hoists them per file. No test here queues a `*Once`
 * value, so the harness's `clearAllMocks` reset is the right one.
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
  appKey, applicationDocs, createTs, failNextAttemptLogs, uploadedObjects, verificationDocs, mockSendDynamicEmail, resetPevState,
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
const EMPLOYER_ID = 'aaaaaaaaaaaa';
const TOKEN = 'portal-token-0123456789abcdef';
const SENT_TOKEN = 'pev-token-123456';

function seedApplication(verification = { status: 'Sent', history: [{ action: 'Sent via Portal' }] }) {
  applicationDocs.set(APP, { employers: [{ companyName: 'Old Carrier', employerId: EMPLOYER_ID, verification }] });
}

function seedRequest({ daysAgo = 0, ...rest } = {}) {
  verificationDocs.set(TOKEN, {
    token: TOKEN,
    requestId: 'req-1',
    status: 'sent',
    companyId: 'co-1',
    collectionName: 'applications',
    applicationId: 'app-1',
    employerIndex: 0,
    employerId: EMPLOYER_ID,
    employerName: 'Old Carrier',
    employerEmail: 'hr@oldcarrier.test',
    applicantName: 'Jane Driver',
    companyName: 'SafeHaul Carrier',
    employmentStartDate: '2021-01',
    employmentEndDate: '2024-01',
    reminderCount: 0,
    openedAt: null,
    attempts: [],
    createdBy: 'recruiter-1',
    createdAt: createTs(Date.now() - daysAgo * DAY),
    expiresAt: createTs(Date.now() + (30 - daysAgo) * DAY),
    ...rest,
  });
}

/** Moves the stored request `days` into the past, as the daily job will see it. */
function age(days) {
  verificationDocs.set(TOKEN, { ...verificationDocs.get(TOKEN), createdAt: createTs(Date.now() - days * DAY) });
}

const attempts = (token = TOKEN) => verificationDocs.get(token).attempts || [];
const kinds = (token = TOKEN) => attempts(token).map((entry) => entry.kind);
const row = () => applicationDocs.get(APP).employers[0].verification;

const sendTo = (overrides = {}) => sendVerificationRequest({
  auth: { uid: 'recruiter-1' },
  data: {
    companyId: 'co-1', applicationId: 'app-1', employerIndex: 0, employerId: EMPLOYER_ID,
    applicantName: 'Jane Driver', employerName: 'Old Carrier',
    employerEmail: 'hr@oldcarrier.test', deliveryMethod: 'email',
    ...overrides,
  },
});

beforeEach(resetPevState);

describe('the request going out', () => {
  it('records an emailed request as sent, by whom', async () => {
    seedApplication({ status: 'Not Started', history: [] });

    await sendTo();

    expect(attempts(SENT_TOKEN)).toEqual([
      { kind: 'sent', at: expect.anything(), ok: true, by: 'recruiter-1', method: 'email' },
    ]);
  });

  // The email has gone out by then: the log write is tried once more, and a
  // second failure leaves the send a success (a retry would email again).
  it('tries the "sent" entry once more when its first write fails, and the send still succeeds', async () => {
    seedApplication({ status: 'Not Started', history: [] });
    failNextAttemptLogs(1);

    await expect(sendTo()).resolves.toMatchObject({ success: true });

    expect(attempts(SENT_TOKEN)).toEqual([
      { kind: 'sent', at: expect.anything(), ok: true, by: 'recruiter-1', method: 'email' },
    ]);
  });

  it('keeps the send a success when the "sent" entry cannot be written twice', async () => {
    seedApplication({ status: 'Not Started', history: [] });
    failNextAttemptLogs(2);
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(sendTo()).resolves.toMatchObject({ success: true });
    } finally {
      errors.mockRestore();
    }
    expect(mockSendDynamicEmail).toHaveBeenCalledTimes(1);
  });

  it('records a request handed over by fax as issued for fax', async () => {
    seedApplication({ status: 'Not Started', history: [] });

    await sendTo({ deliveryMethod: 'fax', employerEmail: null });

    expect(attempts(SENT_TOKEN)).toEqual([
      { kind: 'sent', at: expect.anything(), ok: true, by: 'recruiter-1', method: 'fax' },
    ]);
  });

  it('records a first email that failed, with its reason on the request only', async () => {
    seedApplication({ status: 'Not Started', history: [] });
    mockSendDynamicEmail.mockRejectedValue(new Error('Failed to send email: SMTP down'));

    await sendTo();

    expect(attempts(SENT_TOKEN)).toEqual([
      { kind: 'send_failed', at: expect.anything(), ok: false, by: 'recruiter-1', error: 'Failed to send email: SMTP down' },
    ]);
    expect(row().status).toBe('Not Started');
    expect(row().history).toEqual([
      { action: 'Request email could not be sent', timestamp: expect.any(String), attempt: 'send_failed', ok: false },
    ]);
  });
});

describe('reminders', () => {
  it('records each reminder that went out, on the request and on the row', async () => {
    seedApplication();
    seedRequest({ daysAgo: 6 });

    await processVerificationReminders();
    age(16);
    await processVerificationReminders();

    expect(attempts()).toEqual([
      { kind: 'reminder', at: expect.anything(), ok: true, step: 1 },
      { kind: 'reminder', at: expect.anything(), ok: true, step: 2 },
    ]);
    expect(row().history.map((entry) => entry.action)).toEqual([
      'Sent via Portal', 'First reminder emailed', 'Second reminder emailed',
    ]);
  });

  it('records a reminder that did not go out, and the retry the next day', async () => {
    seedApplication();
    seedRequest({ daysAgo: 6 });
    mockSendDynamicEmail.mockRejectedValue(new Error('SMTP down'));

    await processVerificationReminders();

    expect(verificationDocs.get(TOKEN)).toMatchObject({ status: 'sent', reminderCount: 0 });
    expect(attempts()).toEqual([{ kind: 'reminder', at: expect.anything(), ok: false, step: 1, error: 'SMTP down' }]);
    expect(row().history.at(-1)).toEqual({
      action: 'First reminder could not be sent', timestamp: expect.any(String), attempt: 'reminder', ok: false,
    });

    mockSendDynamicEmail.mockResolvedValue({ success: true });
    await processVerificationReminders();

    expect(kinds()).toEqual(['reminder', 'reminder']);
    expect(attempts()[1]).toMatchObject({ ok: true, step: 1 });
    expect(verificationDocs.get(TOKEN)).toMatchObject({ status: 'reminder_sent', reminderCount: 1 });
  });

  it('keeps a reminder on the record when the answer lands while it is going out', async () => {
    seedApplication();
    seedRequest({ daysAgo: 6 });
    mockSendDynamicEmail.mockImplementation(async () => {
      verificationDocs.set(TOKEN, { ...verificationDocs.get(TOKEN), status: 'completed' });
      return { success: true };
    });

    await processVerificationReminders();

    expect(verificationDocs.get(TOKEN).status).toBe('completed');
    expect(attempts()).toEqual([{ kind: 'reminder', at: expect.anything(), ok: true, step: 1 }]);
  });
});

describe('the employer and the team', () => {
  it('records the first open once', async () => {
    seedApplication();
    seedRequest({ daysAgo: 2 });

    await getVerificationRequest({ data: { token: TOKEN } });
    verificationDocs.set(TOKEN, { ...verificationDocs.get(TOKEN), status: 'reminder_sent', openedAt: createTs(1700000000000) });
    await getVerificationRequest({ data: { token: TOKEN } });

    expect(kinds()).toEqual(['opened']);
  });

  it('records the answer', async () => {
    seedApplication();
    seedRequest({ daysAgo: 2, status: 'opened' });

    await submitVerificationResponse({
      data: { token: TOKEN, response: { respondentName: 'HR Lead', respondentTitle: 'HR', respondentPhone: '555-222-3333' } },
    });

    expect(verificationDocs.get(TOKEN).status).toBe('completed');
    expect(attempts()).toEqual([{ kind: 'response', at: expect.anything(), ok: true }]);
  });

  it('records an uploaded result, by whom', async () => {
    const path = 'companies/co-1/applications/app-1/pev_results/1700000000000_fax.pdf';
    seedApplication();
    seedRequest({ daysAgo: 8, status: 'reminder_sent', reminderCount: 1 });
    uploadedObjects.add(path);

    await recordManualVerificationResult({
      auth: { uid: 'recruiter-2' },
      data: {
        companyId: 'co-1', applicationId: 'app-1', employerId: EMPLOYER_ID, employerIndex: 0,
        employerName: 'Old Carrier', storagePath: path, fileName: 'fax.pdf',
      },
    });

    expect(attempts()).toEqual([{ kind: 'manual_result', at: expect.anything(), ok: true, by: 'recruiter-2' }]);
  });

  it('records the day-30 mark', async () => {
    seedApplication();
    seedRequest({ daysAgo: 31, status: 'reminder_sent', reminderCount: 3 });

    await processVerificationReminders();

    expect(verificationDocs.get(TOKEN).status).toBe('no_response');
    expect(kinds()).toEqual(['no_response']);
  });
});

it('never writes the token or an address into the log or the row', async () => {
  seedApplication();
  seedRequest({ daysAgo: 6 });
  mockSendDynamicEmail.mockRejectedValue(new Error('SMTP down'));
  await processVerificationReminders();
  mockSendDynamicEmail.mockResolvedValue({ success: true });
  await processVerificationReminders();
  await getVerificationRequest({ data: { token: TOKEN } });

  const written = JSON.stringify([attempts(), row()]);
  expect(written).not.toContain(TOKEN);
  expect(written).not.toContain('hr@oldcarrier.test');
  expect(JSON.stringify(row())).not.toContain('SMTP down');
});
