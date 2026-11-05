/**
 * Remind: a team member sends an unsigned document's signing link to its
 * signer again, from the document's details or the dossier.
 *
 * The callable runs against a small document store whose transactions apply
 * their writes only when they succeed, as Firestore's do
 * (`signingRequestStore.support.js`); the real senders
 * (`emailSigningLink`, `textSigningLink`) and the correction trigger run on
 * what it writes, so "one press is one message" is checked on what is sent.
 * Send to driver and the creation triggers make the request where a test needs
 * one made the way the app makes it. All names, addresses and numbers are
 * artificial.
 */
jest.mock('firebase-functions/v2/https', () => ({
    onCall: (optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn),
    HttpsError: class HttpsError extends Error {
        constructor(code, message, details) {
            super(message);
            this.code = code;
            this.details = details;
        }
    },
}));
jest.mock('firebase-functions/v1', () => {
    const firestore = { document: () => ({ onCreate: (fn) => fn }) };
    return { firestore, runWith: () => ({ firestore }) };
});
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
    onDocumentUpdated: (_opts, fn) => fn,
}));

// The document store (`signingRequestStore.support.js`): read and written by
// path, a stored timestamp `{ ms }` that reads back with `toMillis`.
jest.mock('../../firebaseAdmin', () => require('./signingRequestStore.support').firebaseAdminMock());
const { docs: mockDocs, revive: mockRevive, ref: mockRef, update: mockUpdate } = require('./signingRequestStore.support');
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAccessForRequest: jest.fn() }));
const mockSendEmail = jest.fn();
jest.mock('../../emailService', () => ({ sendDynamicEmail: (...args) => mockSendEmail(...args) }));
const mockSendSms = jest.fn();
jest.mock('../../integrations/factory', () => ({
    getAdapterForUser: async () => ({ sendSMS: (...args) => mockSendSms(...args) }),
}));

const { remindSigner } = require('../../remindSigner');
const { sendPostApplicationDocument } = require('../../sendPostApplicationDocument');
const { notifySigner } = require('../../notifySigner');
const { notifySignerSMS } = require('../../notifySignerSMS');
const { resendSignerOnCorrection } = require('../../resendSignerOnCorrection');
const { assertCompanyAccessForRequest } = require('../../shared/companyAccess');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const COMPANY = 'companies/co-1';
const REQUEST_ID = 'req-1';
const REQUEST = `${COMPANY}/signing_requests/${REQUEST_ID}`;
const TOKEN = `${REQUEST}/secrets/token`;
const APPLICATION = `${COMPANY}/applications/app-1`;
const LINK = `https://truckerapp-system.web.app/sign/co-1/${REQUEST_ID}?token=token-1`;

/** A document a recruiter emailed eight days ago, whose link ran out yesterday. */
const EMAILED = {
    companyId: 'co-1',
    title: 'Offer Letter',
    status: 'sent',
    recipientName: 'Dana Driver',
    recipientEmail: 'dana@example.test',
    recipientPhone: '(555) 555-0100',
    sendEmail: true,
    sendSms: false,
    deliveryMethod: 'email',
    senderId: 'user-2',
    senderName: 'Rita Recruiter',
    appBaseUrl: 'https://truckerapp-system.web.app',
    linkSentTo: { email: 'dana@example.test' },
    emailStatus: 'sent',
    expiresAt: { ms: Date.now() - DAY },
};

function seed(request = EMAILED, { application } = {}) {
    mockDocs.set(REQUEST, structuredClone(request));
    mockDocs.set(TOKEN, { accessToken: 'token-1' });
    if (application) mockDocs.set(APPLICATION, structuredClone(application));
}

const current = () => mockDocs.get(REQUEST);
const emailedTo = () => mockSendEmail.mock.calls.map(([, to]) => to);
const remind = (data = {}, auth = { uid: 'user-1', token: { name: 'Rita Recruiter' } }) => remindSigner({
    auth,
    data: { companyId: 'co-1', requestId: REQUEST_ID, ...data },
});

async function refusal(promise) {
    try {
        await promise;
    } catch (error) {
        return { code: error.code, message: error.message, reason: error.details?.reason };
    }
    throw new Error('Expected a refusal');
}

function expectNothingWritten(snapshot) {
    expect([...mockDocs.entries()]).toEqual(snapshot);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
}

beforeEach(() => {
    jest.resetAllMocks();
    mockDocs.clear();
    mockSendEmail.mockResolvedValue(undefined);
    mockSendSms.mockResolvedValue(undefined);
    assertCompanyAccessForRequest.mockResolvedValue(undefined);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('a document waiting for its signature', () => {
    it('is emailed its link again, as a reminder, with seven more days, and the reminder is recorded', async () => {
        seed();

        await expect(remind()).resolves.toEqual({ success: true, requestId: REQUEST_ID, channels: { email: true, sms: false } });

        expect(emailedTo()).toEqual(['dana@example.test']);
        const [companyId, , subject, html] = mockSendEmail.mock.calls[0];
        expect(companyId).toBe('co-1');
        expect(subject).toBe('Reminder: Please Sign "Offer Letter"');
        expect(html).toContain(LINK);
        expect(html).toContain('still waiting for your signature');
        expect(mockSendSms).not.toHaveBeenCalled();

        const request = current();
        // The same link: the token is unchanged, and it works seven days again.
        expect(mockDocs.get(TOKEN)).toEqual({ accessToken: 'token-1' });
        expect(request.expiresAt.ms).toBeGreaterThan(Date.now() + 7 * DAY - MINUTE);
        expect(request.linkSentTo).toEqual({ email: 'dana@example.test' });
        expect(request.reminders).toEqual({ count: 1, lastAt: { ms: expect.any(Number) }, lastBy: 'user-1' });
        expect(Math.abs(request.reminders.lastAt.ms - Date.now())).toBeLessThan(5000);
        expect(request.emailStatus).toBe('sent');
        // What the request is stays as it was.
        expect(request).toMatchObject({ status: 'sent', title: 'Offer Letter', senderId: 'user-2', sendEmail: true, sendSms: false });
    });

    it('is reminded while its link still works too', async () => {
        seed({ ...EMAILED, expiresAt: { ms: Date.now() + 2 * DAY } });

        await expect(remind()).resolves.toMatchObject({ channels: { email: true, sms: false } });
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(current().expiresAt.ms).toBeGreaterThan(Date.now() + 7 * DAY - MINUTE);
    });

    it('is texted again, as a reminder, when it was sent by text', async () => {
        seed({ ...EMAILED, sendSms: true, deliveryMethod: 'both', linkSentTo: { email: 'dana@example.test', phone: '+15555550100' } });

        await expect(remind()).resolves.toMatchObject({ channels: { email: true, sms: true } });

        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendSms).toHaveBeenCalledWith(
            '(555) 555-0100',
            `📄 Reminder: Rita Recruiter sent you "Offer Letter" to sign. Sign here: ${LINK}`,
            'user-2',
        );
        expect(current()).toMatchObject({ smsStatus: 'sent', linkSentTo: { email: 'dana@example.test', phone: '+15555550100' } });
    });

    it('counts every reminder, once the last is ten minutes old', async () => {
        seed({ ...EMAILED, reminders: { count: 2, lastAt: { ms: Date.now() - 11 * MINUTE }, lastBy: 'user-2' } });

        await expect(remind()).resolves.toMatchObject({ success: true });
        expect(current().reminders).toMatchObject({ count: 3, lastBy: 'user-1' });
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });

    it('is not written to again by the correction trigger: a reminder is no change of address', async () => {
        seed();
        const before = structuredClone(current());
        await remind();
        const after = mockRevive(structuredClone(current()));

        await resendSignerOnCorrection({
            id: 'update-1',
            params: { companyId: 'co-1', requestId: REQUEST_ID },
            data: { before: { data: () => mockRevive(before) }, after: { data: () => after, ref: mockRef(REQUEST) } },
        });
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockSendSms).not.toHaveBeenCalled();
    });

    it('gets a new link when a correction left the old one with an address the request no longer has', async () => {
        seed({ ...EMAILED, recipientEmail: 'dana.new@example.test', linkSentTo: { email: 'dana@example.test' } });

        await remind();

        const newToken = mockDocs.get(TOKEN).accessToken;
        expect(newToken).not.toBe('token-1');
        expect(emailedTo()).toEqual(['dana.new@example.test']);
        expect(mockSendEmail.mock.calls[0][3]).toContain(`?token=${newToken}`);
        expect(current().linkSentTo).toEqual({ email: 'dana.new@example.test' });
    });
});

describe('a send that fails after the claim', () => {
    it('is recorded on the document and answered as not sent, never as sent', async () => {
        seed({ ...EMAILED, sendSms: true, deliveryMethod: 'both' });
        mockSendEmail.mockRejectedValue(new Error('SMTP 535 authentication failed (artificial)'));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(remind()).resolves.toEqual({
            success: true,
            requestId: REQUEST_ID,
            channels: { email: false, sms: true },
            failed: { email: true, sms: false },
        });
        expect(current()).toMatchObject({ emailStatus: 'failed', emailError: 'SMTP 535 authentication failed (artificial)', smsStatus: 'sent' });
        // The claim stands: the link has its seven days, and the next press waits out the ten minutes.
        expect(current().reminders.count).toBe(1);
    });

    it('that reached no one does not count, so the next press may go at once', async () => {
        seed();
        mockSendEmail.mockRejectedValueOnce(new Error('SMTP 535 authentication failed (artificial)'));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(remind()).resolves.toEqual({
            success: true,
            requestId: REQUEST_ID,
            channels: { email: false, sms: false },
            failed: { email: true, sms: false },
        });
        expect(current().reminders).toBeUndefined();

        await expect(remind()).resolves.toMatchObject({ channels: { email: true, sms: false } });
        expect(mockSendEmail).toHaveBeenCalledTimes(2);
        expect(current().reminders).toMatchObject({ count: 1, lastBy: 'user-1' });
    });

    it('that reached no one leaves the earlier reminders as they were', async () => {
        const earlier = { count: 2, lastAt: { ms: Date.now() - 11 * MINUTE }, lastBy: 'user-2' };
        seed({ ...EMAILED, reminders: earlier });
        mockSendEmail.mockRejectedValueOnce(new Error('SMTP 535 authentication failed (artificial)'));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(remind()).resolves.toMatchObject({ channels: { email: false, sms: false } });
        expect(current().reminders).toEqual(earlier);
    });
});

describe('one press is one message', () => {
    it('refuses a second reminder within ten minutes, saying when, and writes nothing', async () => {
        seed();
        await remind();
        mockSendEmail.mockClear();
        const before = [...mockDocs.entries()];

        const second = await refusal(remind());

        expect(second).toMatchObject({ code: 'failed-precondition', reason: 'cooldown' });
        expect(second.message).toMatch(/less than ten minutes ago\. You can send another in 10 minutes\./);
        expectNothingWritten(before);
    });

    it('says how many minutes are left', async () => {
        seed({ ...EMAILED, reminders: { count: 1, lastAt: { ms: Date.now() - 7.5 * MINUTE }, lastBy: 'user-2' } });

        expect((await refusal(remind())).message).toMatch(/in 3 minutes\./);
    });
});

describe('texts follow the signing-text rules', () => {
    const forApplication = { ...EMAILED, sourceApplicationId: 'app-1', sendSms: true, deliveryMethod: 'both' };

    it('texts an application\'s driver only after their Yes to texts', async () => {
        seed(forApplication, { application: { 'sms-consent': 'yes' } });

        await expect(remind()).resolves.toMatchObject({ channels: { email: true, sms: true } });
        expect(mockSendSms).toHaveBeenCalledTimes(1);
    });

    it('emails, and says it did not text, when the driver did not answer Yes', async () => {
        seed(forApplication, { application: { 'sms-consent': 'no' } });

        await expect(remind()).resolves.toEqual({
            success: true,
            requestId: REQUEST_ID,
            channels: { email: true, sms: false },
            textSkipped: 'no-sms-consent',
        });
        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendSms).not.toHaveBeenCalled();
        expect(current().linkSentTo).toEqual({ email: 'dana@example.test' });
    });

    it('refuses, saying why and writing nothing, when the text was its only channel', async () => {
        seed({ ...forApplication, sendEmail: false, deliveryMethod: 'sms', linkSentTo: { phone: '+15555550100' } }, { application: {} });
        const before = [...mockDocs.entries()];

        const refused = await refusal(remind());

        expect(refused).toMatchObject({ code: 'failed-precondition', reason: 'no-channel' });
        expect(refused.message).toMatch(/did not answer Yes to text messages/);
        expectNothingWritten(before);
    });

    it('does not text a number on the opt-out list, records why, and says the text did not go', async () => {
        seed({ ...EMAILED, sendSms: true, deliveryMethod: 'both' });
        mockDocs.set(`${COMPANY}/blacklist/+15555550100`, { reason: 'STOP' });

        await expect(remind()).resolves.toMatchObject({ channels: { email: true, sms: false }, failed: { email: false, sms: true } });
        expect(mockSendSms).not.toHaveBeenCalled();
        expect(current()).toMatchObject({ smsStatus: 'failed', smsError: 'Not texted: this number opted out of texts.' });
        expect(emailedTo()).toEqual(['dana@example.test']);
    });
});

describe('a document that cannot be reminded', () => {
    it.each(['signed', 'pending_seal', 'error_sealing'])('a %s document is refused as signed, writing nothing', async (status) => {
        seed({ ...EMAILED, status });
        const before = [...mockDocs.entries()];

        expect(await refusal(remind())).toMatchObject({ code: 'failed-precondition', message: expect.stringContaining('already signed') });
        expectNothingWritten(before);
    });

    it.each([
        ['voided', 'voided'],
        ['processing', 'submitting'],
    ])('a %s document is refused with its reason, writing nothing', async (status, word) => {
        seed({ ...EMAILED, status });
        const before = [...mockDocs.entries()];

        expect(await refusal(remind())).toMatchObject({ code: 'failed-precondition', message: expect.stringContaining(word) });
        expectNothingWritten(before);
    });

    it('a document shared by a copied link has nothing to send again', async () => {
        seed({ ...EMAILED, sendEmail: false, sendSms: false, deliveryMethod: 'copy', linkSentTo: {} });
        const before = [...mockDocs.entries()];

        const refused = await refusal(remind());

        expect(refused).toMatchObject({ code: 'failed-precondition', reason: 'no-channel' });
        expect(refused.message).toMatch(/copied link/);
        expectNothingWritten(before);
    });

    it('a document with no link at all is refused, writing nothing', async () => {
        seed();
        mockDocs.delete(TOKEN);
        const before = [...mockDocs.entries()];

        expect(await refusal(remind())).toMatchObject({ code: 'failed-precondition', message: expect.stringContaining('no working link') });
        expectNothingWritten(before);
    });

    it('a document that does not exist is not found', async () => {
        expect(await refusal(remind())).toMatchObject({ code: 'not-found' });
    });
});

describe('who may remind', () => {
    it('asks for company access first, and writes nothing when it is refused', async () => {
        seed();
        const { HttpsError } = require('firebase-functions/v2/https');
        assertCompanyAccessForRequest.mockRejectedValueOnce(new HttpsError('permission-denied', 'You do not have access to this company.'));
        const before = [...mockDocs.entries()];

        expect(await refusal(remind())).toMatchObject({ code: 'permission-denied' });
        expect(assertCompanyAccessForRequest).toHaveBeenCalledWith(expect.anything(), 'co-1', 'remindSigner');
        expectNothingWritten(before);
    });

    it('asks for a signed-in caller', async () => {
        seed();
        expect(await refusal(remindSigner({ data: { companyId: 'co-1', requestId: REQUEST_ID } }))).toMatchObject({ code: 'unauthenticated' });
        expect(assertCompanyAccessForRequest).not.toHaveBeenCalled();
    });

    it.each([
        [{ companyId: '' }],
        [{ requestId: '' }],
        [{ requestId: 'a/b' }],
    ])('refuses a request without a usable id (%o)', async (data) => {
        seed();
        expect(await refusal(remind(data))).toMatchObject({ code: 'invalid-argument' });
        expect(assertCompanyAccessForRequest).not.toHaveBeenCalled();
    });
});

describe('a post-application form sent with Send to driver', () => {
    const FORM_ID = 'postapp_app-1_tpl-1';
    const FORM = `${COMPANY}/signing_requests/${FORM_ID}`;

    it('is reminded after Send to driver answered already-sent, with its own link', async () => {
        mockDocs.set(COMPANY, { companyName: 'Demo Logistics', postApplicationTemplates: [{ templateId: 'tpl-1', title: 'W-9', enabled: true }] });
        mockDocs.set(APPLICATION, {
            confirmationNumber: 'SAF-2026-ABCDE', firstName: 'Dana', lastName: 'Driver', email: 'dana@example.test', 'sms-consent': 'no',
        });
        mockDocs.set(`${COMPANY}/templates/tpl-1`, {
            title: 'W-9 Form',
            storagePath: 'secure_documents/co-1/templates/w9.pdf',
            fields: [{ id: 'sig', type: 'signature', required: true, defaultValue: '' }],
        });
        const sendData = { companyId: 'co-1', applicationId: 'app-1', templateId: 'tpl-1', appBaseUrl: 'https://truckerapp-system.web.app' };
        const auth = { uid: 'user-1', token: { name: 'Rita Recruiter' } };
        await sendPostApplicationDocument({ auth, data: sendData });
        const created = mockRevive(structuredClone(mockDocs.get(FORM)));
        const params = { companyId: 'co-1', requestId: FORM_ID };
        await notifySigner({ data: () => created, ref: mockRef(FORM) }, { params });
        await notifySignerSMS({ id: 'create-1', params, data: { data: () => created, ref: mockRef(FORM) } });
        await expect(sendPostApplicationDocument({ auth, data: sendData })).resolves.toMatchObject({ outcome: 'already-sent' });
        mockUpdate(FORM, { expiresAt: { ms: Date.now() - DAY } });
        mockSendEmail.mockClear();

        await expect(remind({ requestId: FORM_ID })).resolves.toMatchObject({ channels: { email: true, sms: false } });

        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendEmail.mock.calls[0][3]).toContain(`/sign/co-1/${FORM_ID}?token=${mockDocs.get(`${FORM}/secrets/token`).accessToken}`);
        expect(mockDocs.get(FORM).expiresAt.ms).toBeGreaterThan(Date.now() + 7 * DAY - MINUTE);
        expect(mockSendSms).not.toHaveBeenCalled();
    });
});
