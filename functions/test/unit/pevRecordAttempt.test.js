/**
 * PEV — "Record attempt": a recruiter records a phone call, a fax or a note
 * against an employer's request.
 *
 * The team cannot write `verification_requests`, so `recordVerificationAttempt`
 * adds the entry to the request's attempt log and a short copy to the employer
 * row, in one transaction.
 *
 * `employmentVerification.support.js` holds the harness. No test here queues a
 * `*Once` value, so the harness's `clearAllMocks` reset is the right one.
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
  appKey, applicationDocs, companyDocs, createTs, verificationDocs, mockAssertCompanyAccessForRequest, resetPevState,
} = require('./employmentVerification.support');

const { recordVerificationAttempt } = require('../../employmentVerification');

const DAY = 24 * 60 * 60 * 1000;
const APP = appKey('co-1', 'applications', 'app-1');
const OLD_CARRIER = 'aaaaaaaaaaaa';
const OTHER_CARRIER = 'bbbbbbbbbbbb';
const YESTERDAY = new Date(Date.now() - DAY).toISOString().slice(0, 10);

function seedApplication() {
  applicationDocs.set(APP, {
    employers: [
      { companyName: 'Old Carrier', employerId: OLD_CARRIER, verification: { status: 'Sent', history: [{ action: 'Sent via Portal' }] } },
      { companyName: 'Other Carrier', employerId: OTHER_CARRIER, verification: { status: 'Sent', history: [] } },
    ],
  });
}

function seedRequest(token, { daysAgo = 3, status = 'sent', employerId = OLD_CARRIER, ...rest } = {}) {
  verificationDocs.set(token, {
    token,
    requestId: `req-${token}`,
    status,
    companyId: 'co-1',
    collectionName: 'applications',
    applicationId: 'app-1',
    employerIndex: employerId === OLD_CARRIER ? 0 : 1,
    employerId,
    employerName: employerId === OLD_CARRIER ? 'Old Carrier' : 'Other Carrier',
    attempts: [{ kind: 'sent', at: createTs(Date.now() - daysAgo * DAY), ok: true, method: 'email' }],
    createdAt: createTs(Date.now() - daysAgo * DAY),
    ...rest,
  });
}

const record = (data = {}, auth = { uid: 'recruiter-1' }) => recordVerificationAttempt({
  auth,
  data: {
    companyId: 'co-1', applicationId: 'app-1', employerId: OLD_CARRIER, employerIndex: 0, employerName: 'Old Carrier',
    kind: 'call', date: YESTERDAY, note: 'Left a voicemail with HR',
    ...data,
  },
});

const row = (index = 0) => applicationDocs.get(APP).employers[index].verification;
const recorded = (token) => (verificationDocs.get(token).attempts || []).filter((entry) => entry.kind !== 'sent');

beforeEach(() => {
  resetPevState();
  companyDocs.set('co-1', {
    ...companyDocs.get('co-1'),
    teamMembers: [{ userId: 'recruiter-1', role: 'recruiter', name: 'Rita Recruiter', email: 'rita@carrier.test' }],
  });
});

describe('recording an attempt', () => {
  it('adds it to the employer\'s live request and to the row, dated the day the recruiter gave', async () => {
    seedApplication();
    seedRequest('live-token');

    const result = await record();

    expect(recorded('live-token')).toEqual([{
      kind: 'call',
      at: expect.objectContaining({ toMillis: expect.any(Function) }),
      ok: true,
      by: 'recruiter-1',
      note: 'Left a voicemail with HR',
      recordedAt: expect.anything(),
    }]);
    expect(recorded('live-token')[0].at.toMillis()).toBe(Date.parse(`${YESTERDAY}T12:00:00.000Z`));
    expect(row().history.at(-1)).toEqual({
      action: 'Phone call',
      timestamp: `${YESTERDAY}T12:00:00.000Z`,
      attempt: 'call',
      ok: true,
      note: 'Left a voicemail with HR',
      recordedBy: 'Rita Recruiter',
    });
    expect(row().status).toBe('Sent');
    expect(result).toEqual({ success: true, verification: row() });
    // Another employer's row and request are untouched.
    expect(row(1).history).toEqual([]);
  });

  it('records a fax, and a note, with the note cut to 300 plain characters', async () => {
    seedApplication();
    seedRequest('live-token');

    await record({ kind: 'fax', note: '' });
    await record({ kind: 'note', note: `Spoke to\nthe office manager. ${'x'.repeat(400)}` });

    expect(row().history.slice(-2).map((entry) => entry.action)).toEqual(['Fax', 'Note']);
    expect(row().history.at(-2)).not.toHaveProperty('note');
    const note = row().history.at(-1).note;
    expect(Array.from(note)).toHaveLength(301);
    expect(note.startsWith('Spoke to the office manager. x')).toBe(true);
    expect(note.endsWith('…')).toBe(true);
  });

  it('goes on the newest live request, not one a resend replaced', async () => {
    seedApplication();
    seedRequest('old-token', { daysAgo: 20, status: 'superseded' });
    seedRequest('new-token', { daysAgo: 2, status: 'opened' });

    await record();

    expect(recorded('old-token')).toEqual([]);
    expect(recorded('new-token')).toHaveLength(1);
  });

  it('goes on the newest request when none is live, a request past day 30 included', async () => {
    seedApplication();
    seedRequest('nr-token', { daysAgo: 35, status: 'no_response' });

    await record();

    expect(recorded('nr-token')).toHaveLength(1);
  });

  it('works for a lead', async () => {
    applicationDocs.set(appKey('co-1', 'leads', 'lead-1'), { employers: [{ companyName: 'Old Carrier', employerId: OLD_CARRIER }] });
    seedRequest('lead-token', { collectionName: 'leads', applicationId: 'lead-1' });

    await record({ collectionName: 'leads', applicationId: 'lead-1' });

    expect(recorded('lead-token')).toHaveLength(1);
    expect(applicationDocs.get(appKey('co-1', 'leads', 'lead-1')).employers[0].verification).toMatchObject({
      status: 'Not Started', history: [expect.objectContaining({ action: 'Phone call' })],
    });
  });
});

describe('what it refuses', () => {
  beforeEach(() => {
    seedApplication();
    seedRequest('live-token');
  });

  it.each([
    ['an unknown kind', { kind: 'email' }, 'invalid-argument'],
    ['a date that is not a calendar day', { date: '2026-02-30' }, 'invalid-argument'],
    ['a date in another shape', { date: '11/03/2026' }, 'invalid-argument'],
    ['a date in the future', { date: new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10) }, 'invalid-argument'],
    ['a note without its text', { kind: 'note', note: '   ' }, 'invalid-argument'],
    ['another collection', { collectionName: 'drivers' }, 'invalid-argument'],
    ['an employer no longer on the application', { employerId: 'cccccccccccc', employerIndex: 5 }, 'not-found'],
  ])('refuses %s', async (_label, data, code) => {
    await expect(record(data)).rejects.toMatchObject({ code });
    expect(recorded('live-token')).toEqual([]);
    expect(row().history).toEqual([{ action: 'Sent via Portal' }]);
  });

  it('refuses an employer with no request yet', async () => {
    await expect(record({ employerId: OTHER_CARRIER, employerIndex: 1, employerName: 'Other Carrier' }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(row(1).history).toEqual([]);
  });

  it('refuses a caller outside the company, before writing anything', async () => {
    mockAssertCompanyAccessForRequest.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await expect(record()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(recorded('live-token')).toEqual([]);
  });

  it('refuses a caller who is not signed in', async () => {
    await expect(record({}, null)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  // A resend can replace the request between the lookup and the write; the
  // attempt would then sit on a request whose day-30 record is never made.
  it('refuses when a resend replaced the request while the attempt was being written', async () => {
    seedRequest('live-token');
    const { db } = require('../../firebaseAdmin');
    const real = db.runTransaction.getMockImplementation();
    db.runTransaction.mockImplementation(async (fn) => {
      verificationDocs.set('live-token', { ...verificationDocs.get('live-token'), status: 'superseded' });
      return real(fn);
    });
    try {
      await expect(record()).rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringContaining('replaced') });
    } finally {
      db.runTransaction.mockImplementation(real);
    }
    expect(recorded('live-token')).toEqual([]);
    expect(row().history).toEqual([{ action: 'Sent via Portal' }]);
  });

  it('stops at 50 recorded attempts on one request', async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ kind: 'note', at: createTs(i), ok: true, note: `n${i}` }));
    seedRequest('live-token', { attempts: full });

    await expect(record()).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(row().history).toEqual([{ action: 'Sent via Portal' }]);
  });
});
