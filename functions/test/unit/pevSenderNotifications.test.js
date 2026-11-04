/**
 * PEV — the bell tells whoever sent a request when the employer answers and
 * when day 30 passes with no answer: one notification per event, opening the
 * record's dossier, naming only the employer and the driver.
 *
 * `employmentVerification.support.js` holds the harness.
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
  appKey, applicationDocs, companyDocs, createTs, notificationDocs, verificationDocs,
  mockSendDynamicEmail, resetPevState,
} = require('./employmentVerification.support');

const { processVerificationReminders, submitVerificationResponse } = require('../../employmentVerification');
const { notifyRequestSender } = require('../../employmentVerification/notifications');

const DAY = 24 * 60 * 60 * 1000;
const TOKEN = 'portal-token-0123456789abcdef';

function seed({ collectionName = 'applications', daysAgo = 2, ...rest } = {}) {
  verificationDocs.set(TOKEN, {
    token: TOKEN,
    requestId: 'req-1',
    createdBy: 'recruiter-1',
    status: 'opened',
    companyId: 'co-1',
    collectionName,
    applicationId: 'app-1',
    employerIndex: 0,
    employerId: 'aaaaaaaaaaaa',
    employerName: 'ABC Trucking',
    employerEmail: 'hr@abc.test',
    applicantName: 'Ivan Petrov',
    companyName: 'SafeHaul Carrier',
    reminderCount: 3,
    createdAt: createTs(Date.now() - daysAgo * DAY),
    expiresAt: createTs(Date.now() + (30 - daysAgo) * DAY),
    ...rest,
  });
  applicationDocs.set(appKey('co-1', collectionName, 'app-1'), {
    employers: [{ companyName: 'ABC Trucking', employerId: 'aaaaaaaaaaaa', verification: { status: 'Sent', history: [] } }],
  });
}

const answer = () => submitVerificationResponse({
  data: {
    token: TOKEN,
    response: {
      wasEmployed: true,
      hadAccidents: true,
      accidentDetails: 'Jackknifed on I-35 in March',
      respondentName: 'HR Lead',
      respondentTitle: 'HR Manager',
      respondentPhone: '555-222-3333',
      signatureData: 'TEXT_SIGNATURE:HR Lead',
      signatureMethod: 'typed',
    },
  },
  rawRequest: { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } },
});

const bell = () => [...notificationDocs].filter(([key]) => key.startsWith('co-1/'));

beforeEach(resetPevState);

describe('the employer answers', () => {
  it('notifies the sender once, opening the dossier, with the names only', async () => {
    seed();

    await answer();

    expect(bell()).toHaveLength(1);
    const [[key, notification]] = bell();
    expect(key).toBe('co-1/pev_completed_req-1');
    expect(notification).toMatchObject({
      type: 'pev_completed',
      recipientId: 'recruiter-1',
      relatedType: 'application',
      relatedId: 'app-1',
      read: false,
    });
    expect(notification.message).toContain('ABC Trucking');
    expect(notification.message).toContain('Ivan Petrov');
    // Everyone on the team can read a notification: no answer, no token.
    expect(JSON.stringify(notification)).not.toMatch(/Jackknifed|HR Lead|portal-token/);
  });

  it('notifies even when the company email is not set', async () => {
    companyDocs.set('co-1', { companyName: 'SafeHaul Carrier' });
    seed();

    await answer();

    expect(mockSendDynamicEmail).not.toHaveBeenCalled();
    expect(bell()).toHaveLength(1);
  });

  it('opens a lead\'s dossier for a lead', async () => {
    seed({ collectionName: 'leads' });
    await answer();
    expect(bell()[0][1]).toMatchObject({ relatedType: 'lead', relatedId: 'app-1' });
  });
});

describe('day 30 with no answer', () => {
  it('notifies the sender once, while the company email still goes out', async () => {
    seed({ daysAgo: 31, status: 'reminder_sent' });

    await processVerificationReminders();
    await processVerificationReminders();

    expect(bell()).toHaveLength(1);
    const [[key, notification]] = bell();
    expect(key).toBe('co-1/pev_no_response_req-1');
    expect(notification).toMatchObject({
      type: 'pev_no_response', recipientId: 'recruiter-1', relatedType: 'application', relatedId: 'app-1',
    });
    expect(notification.message).toContain('ABC Trucking');
    expect(notification.message).toContain('Ivan Petrov');
    expect(mockSendDynamicEmail.mock.calls.filter(([, to]) => to === 'ops@safehaul.test')).toHaveLength(1);
  });

  it('notifies even when the company email cannot be sent', async () => {
    seed({ daysAgo: 31, status: 'reminder_sent' });
    mockSendDynamicEmail.mockRejectedValue(new Error('Failed to send email: SMTP down'));

    await processVerificationReminders();

    expect(bell()).toHaveLength(1);
  });

  it('says nothing about a row that already holds the result', async () => {
    seed({ daysAgo: 31, status: 'reminder_sent' });
    applicationDocs.set(appKey('co-1', 'applications', 'app-1'), {
      employers: [{ companyName: 'ABC Trucking', employerId: 'aaaaaaaaaaaa', verification: { status: 'Completed', history: [] } }],
    });

    await processVerificationReminders();

    expect(bell()).toHaveLength(0);
  });
});

describe('the notification', () => {
  it('is created once per event, however often the event is delivered', async () => {
    seed();
    const request = verificationDocs.get(TOKEN);
    await notifyRequestSender(request, TOKEN, 'completed');
    await notifyRequestSender(request, TOKEN, 'completed');
    expect(bell()).toHaveLength(1);
  });

  it('goes to the whole team for a request that predates its sender, named without the token', async () => {
    seed({ createdBy: undefined, requestId: undefined });

    await answer();

    const [[key, notification]] = bell();
    expect(notification.recipientId).toBeUndefined();
    expect(key).toMatch(/^co-1\/pev_completed_[0-9a-f]{32}$/);
    expect(key).not.toContain('portal-token');
  });
});
