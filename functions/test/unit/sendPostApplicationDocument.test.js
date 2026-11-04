/**
 * Send to driver: a team member sends one of the company's post-application
 * forms to an application's driver, from the dossier.
 *
 * The driver's thank-you page makes the same request without sending it, so a
 * driver who closed that page never got the form. The tests run the callable
 * against a small document store and then deliver the events its write causes
 * to the real triggers (`notifySigner`, `notifySignerSMS`,
 * `resendSignerOnCorrection`), so "the driver gets exactly one message" is
 * checked on what is sent, not on which flag was set. All names, addresses and
 * numbers are artificial.
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

// A small document store, read and written by path. A stored timestamp is
// `{ ms }`, and reads back with the `toMillis` a Firestore Timestamp has.
const mockDocs = new Map();
function mockRevive(data) {
    if (typeof data?.expiresAt?.ms !== 'number') return data;
    const { ms } = data.expiresAt;
    return { ...data, expiresAt: { ms, toMillis: () => ms } };
}
function mockSnapshot(path) {
    const data = mockDocs.get(path);
    return { exists: data !== undefined, data: () => mockRevive(structuredClone(data)), get: (field) => data?.[field] };
}
function mockUpdate(path, changes) {
    const doc = structuredClone(mockDocs.get(path) || {});
    for (const [key, value] of Object.entries(changes)) {
        const parts = key.split('.');
        const leaf = parts.pop();
        let target = doc;
        for (const part of parts) {
            target[part] = { ...target[part] };
            target = target[part];
        }
        target[leaf] = value;
    }
    mockDocs.set(path, doc);
}
function mockRef(path) {
    return {
        path,
        id: path.split('/').pop(),
        collection: (name) => ({ doc: (id) => mockRef(`${path}/${name}/${id}`) }),
        get: async () => mockSnapshot(path),
        set: async (data) => mockDocs.set(path, structuredClone(data)),
        update: async (data) => mockUpdate(path, data),
    };
}
jest.mock('../../firebaseAdmin', () => {
    const db = {
        runTransaction: async (fn) => fn({
            get: async (ref) => mockSnapshot(ref.path),
            set: (ref, data) => mockDocs.set(ref.path, structuredClone(data)),
            update: (ref, data) => mockUpdate(ref.path, data),
        }),
        collection: (name) => ({ doc: (id) => mockRef(`${name}/${id}`) }),
    };
    const firestore = Object.assign(() => db, {
        FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
        Timestamp: { fromMillis: (ms) => ({ ms }) },
    });
    return { admin: { firestore }, db };
});
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAccessForRequest: jest.fn() }));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn() }));
jest.mock('../../shared/companyTenant', () => ({ assertCompanyAcceptingIntake: jest.fn() }));
const mockSendEmail = jest.fn();
jest.mock('../../emailService', () => ({ sendDynamicEmail: (...args) => mockSendEmail(...args) }));
const mockSendSms = jest.fn();
jest.mock('../../integrations/factory', () => ({
    getAdapterForUser: async () => ({ sendSMS: (...args) => mockSendSms(...args) }),
}));

const { sendPostApplicationDocument } = require('../../sendPostApplicationDocument');
const { createPostApplicationSigningRequest } = require('../../postApplicationEdocs');
const { notifySigner } = require('../../notifySigner');
const { notifySignerSMS } = require('../../notifySignerSMS');
const { resendSignerOnCorrection } = require('../../resendSignerOnCorrection');
const { assertCompanyAccessForRequest } = require('../../shared/companyAccess');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('../../shared/companyTenant');

const DAY_MS = 24 * 60 * 60 * 1000;
const COMPANY = 'companies/co-1';
const APPLICATION = `${COMPANY}/applications/app-1`;
const REQUEST_ID = 'postapp_app-1_tpl-1';
const REQUEST = `${COMPANY}/signing_requests/${REQUEST_ID}`;
const TOKEN = `${REQUEST}/secrets/token`;
const SSN = '123-45-6789';

const FORMS = [{ templateId: 'tpl-1', title: 'W-9', enabled: true, required: true }];
const APP = {
    confirmationNumber: 'SAF-2026-ABCDE',
    firstName: 'Dana',
    lastName: 'Driver',
    email: 'dana@example.test',
    phone: '(555) 555-0100',
    'sms-consent': 'no',
    ssn: SSN,
};
const TEMPLATE = {
    title: 'W-9 Form',
    storagePath: 'secure_documents/co-1/templates/w9.pdf',
    fields: [
        { id: 'name', type: 'text', required: true, prefillPolicy: 'locked', bindingKey: 'full_name', defaultValue: '' },
        { id: 'tax', type: 'text', required: false, defaultValue: '{{ssn}}' },
        { id: 'sig', type: 'signature', required: true, defaultValue: '' },
    ],
};

const current = () => mockDocs.get(REQUEST);
const token = () => mockDocs.get(TOKEN)?.accessToken;
const emailedTo = () => mockSendEmail.mock.calls.map(([, to]) => to);
const params = { companyId: 'co-1', requestId: REQUEST_ID };

function seed({ application = APP, forms = FORMS, template = TEMPLATE } = {}) {
    mockDocs.set(COMPANY, { companyName: 'Demo Logistics', postApplicationTemplates: forms });
    mockDocs.set('public_profiles/co-1', { companyName: 'Demo Logistics', postApplicationTemplates: forms });
    mockDocs.set(APPLICATION, structuredClone(application));
    mockDocs.set(`${COMPANY}/templates/tpl-1`, structuredClone(template));
}

const send = (data = {}, auth = { uid: 'user-1', token: { name: 'Rita Recruiter' } }) => sendPostApplicationDocument({
    auth,
    data: { companyId: 'co-1', applicationId: 'app-1', templateId: 'tpl-1', appBaseUrl: 'https://app.example.test', ...data },
});

/** The driver opening the form on the thank-you page. */
const openOnThankYouPage = () => createPostApplicationSigningRequest({
    data: {
        companyId: 'co-1',
        applicationId: 'app-1',
        confirmationNumber: APP.confirmationNumber,
        templateId: 'tpl-1',
        appBaseUrl: 'https://app.example.test',
    },
    rawRequest: { ip: '203.0.113.10' },
});

/** The creation triggers, as Firestore delivers a new request to them. */
async function deliverCreate(id = 'create-1') {
    const data = structuredClone(current());
    await notifySigner({ data: () => data, ref: mockRef(REQUEST) }, { params });
    await notifySignerSMS({ id, params, data: { data: () => data, ref: mockRef(REQUEST) } });
}

/** Runs `write` and returns the update event it causes, for the correction trigger. */
async function updateEvent(write, id = 'update-1') {
    const before = structuredClone(current());
    const result = await write();
    const after = structuredClone(current());
    return { result, event: { id, params, data: { before: { data: () => before }, after: { data: () => after, ref: mockRef(REQUEST) } } } };
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
    checkRateLimit.mockResolvedValue(true);
    assertCompanyAcceptingIntake.mockResolvedValue({ companyName: 'Demo Logistics', isActive: true });
});

describe('a form nobody has opened yet', () => {
    it('is made with its send flags, at the same document the thank-you page uses, and emailed once', async () => {
        seed();
        const result = await send();

        expect(result).toEqual({ success: true, requestId: REQUEST_ID, outcome: 'sent', channels: { email: true, sms: false } });
        expect(current()).toMatchObject({
            companyId: 'co-1',
            templateId: 'tpl-1',
            sourceApplicationId: 'app-1',
            title: 'W-9 Form',
            status: 'sent',
            recipientName: 'Dana Driver',
            recipientEmail: 'dana@example.test',
            sendEmail: true,
            sendSms: false,
            deliveryMethod: 'email',
            senderId: 'user-1',
            senderName: 'Rita Recruiter',
            appBaseUrl: 'https://app.example.test',
        });
        // Filled only from the listed application fields; the token only in secrets.
        expect(current().fields.find((f) => f.id === 'name')).toMatchObject({ defaultValue: 'Dana Driver', readOnly: true });
        expect(current().fields.find((f) => f.id === 'tax').defaultValue).toBe('');
        expect(JSON.stringify(current())).not.toContain(SSN);
        expect(current().accessToken).toBeUndefined();
        expect(token()).toEqual(expect.any(String));
        expect(current().expiresAt.ms).toBeGreaterThan(Date.now() + 7 * DAY_MS - 60 * 1000);

        await deliverCreate();
        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendEmail.mock.calls[0][3]).toContain(`https://app.example.test/sign/co-1/${REQUEST_ID}?token=${token()}`);
        expect(mockSendSms).not.toHaveBeenCalled();
        expect(current().linkSentTo).toEqual({ email: 'dana@example.test' });
    });

    it('is texted too only after the driver answered Yes to texts', async () => {
        seed({ application: { ...APP, 'sms-consent': 'yes' } });
        const result = await send();

        expect(result.channels).toEqual({ email: true, sms: true });
        expect(current()).toMatchObject({ sendEmail: true, sendSms: true, deliveryMethod: 'both', recipientPhone: '(555) 555-0100' });
        await deliverCreate();
        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendSms).toHaveBeenCalledTimes(1);
        expect(mockSendSms.mock.calls[0][0]).toBe('(555) 555-0100');
        expect(mockSendSms.mock.calls[0][2]).toBe('user-1');
    });

    it('goes by text alone when the driver said Yes to texts and has no usable email', async () => {
        seed({ application: { ...APP, email: 'dana@placeholder.safehaulapp.com', 'sms-consent': 'Yes' } });
        const result = await send();

        expect(result.channels).toEqual({ email: false, sms: true });
        expect(current()).toMatchObject({ sendEmail: false, sendSms: true, deliveryMethod: 'sms' });
        await deliverCreate();
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockSendSms).toHaveBeenCalledTimes(1);
    });

    it('is refused, saying why and writing nothing, when there is no email and no Yes to texts', async () => {
        seed({ application: { ...APP, email: 'not an address', 'sms-consent': '' } });
        const before = [...mockDocs.entries()];

        await expect(send()).rejects.toMatchObject({
            code: 'failed-precondition',
            details: { reason: 'no-channel' },
            message: expect.stringContaining('no email address'),
        });
        expectNothingWritten(before);
    });

    it('is the document the thank-you page then finds, with the link that was emailed', async () => {
        seed();
        await send();
        await deliverCreate();
        const emailedLink = mockSendEmail.mock.calls[0][3];

        const opened = await openOnThankYouPage();
        expect(opened).toMatchObject({ success: true, requestId: REQUEST_ID });
        expect(emailedLink).toContain(`?token=${opened.accessToken}`);
        expect(mockDocs.has(`${COMPANY}/signing_requests/${REQUEST_ID}`)).toBe(true);
    });
});

describe('a form the driver opened on the thank-you page', () => {
    it('is sent once when its flags go on, by the correction trigger, with seven more days', async () => {
        seed();
        await openOnThankYouPage();
        expect(current()).toMatchObject({ sendEmail: false, sendSms: false, deliveryMethod: 'in_app_post_submit' });
        // The page's link ran out before anybody pressed Send.
        mockUpdate(REQUEST, { expiresAt: { ms: Date.now() - DAY_MS } });
        const pageToken = token();

        const { result, event } = await updateEvent(() => send());
        expect(result).toEqual({ success: true, requestId: REQUEST_ID, outcome: 'sent', channels: { email: true, sms: false } });
        expect(current()).toMatchObject({
            sendEmail: true,
            sendSms: false,
            deliveryMethod: 'email',
            senderId: 'user-1',
            senderName: 'Rita Recruiter',
            // Untouched: what the request is.
            source: 'post_application_success',
            title: 'W-9 Form',
        });

        await resendSignerOnCorrection(event);
        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendEmail.mock.calls[0][3]).toContain(`?token=${pageToken}`);
        expect(current().linkSentTo).toEqual({ email: 'dana@example.test' });
        expect(current().expiresAt.ms).toBeGreaterThan(Date.now() + 7 * DAY_MS - 60 * 1000);

        // Firestore may deliver the same change twice: still one email.
        await resendSignerOnCorrection(event);
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockSendSms).not.toHaveBeenCalled();
    });

    it('is not sent again once it went out: a second press writes nothing', async () => {
        seed({ application: { ...APP, 'sms-consent': 'yes' } });
        await openOnThankYouPage();
        const { event } = await updateEvent(() => send());
        await resendSignerOnCorrection(event);
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockSendSms).toHaveBeenCalledTimes(1);
        mockSendEmail.mockClear();
        mockSendSms.mockClear();
        const before = [...mockDocs.entries()];

        await expect(send()).resolves.toEqual({ success: true, requestId: REQUEST_ID, outcome: 'already-sent', channels: { email: false, sms: false } });
        expectNothingWritten(before);
    });

    it('gets a token in the same write when it has none, which the link then carries', async () => {
        seed();
        await openOnThankYouPage();
        mockDocs.delete(TOKEN);

        const { event } = await updateEvent(() => send());
        expect(token()).toEqual(expect.any(String));
        await resendSignerOnCorrection(event);
        expect(mockSendEmail.mock.calls[0][3]).toContain(`?token=${token()}`);
    });

    it('is refused, saying why, when there is no email and no Yes to texts', async () => {
        seed({ application: { ...APP, email: '', 'sms-consent': 'no' } });
        await openOnThankYouPage();
        const before = [...mockDocs.entries()];

        await expect(send()).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'no-channel' } });
        expectNothingWritten(before);
    });
});

describe('a form that is finished or out of reach', () => {
    it.each([
        ['signed', 'signed'],
        ['pending_seal', 'signed'],
        ['error_sealing', 'signed'],
    ])('a %s form is not sent again', async (status, outcome) => {
        seed();
        await openOnThankYouPage();
        mockUpdate(REQUEST, { status });
        const before = [...mockDocs.entries()];

        await expect(send()).resolves.toMatchObject({ outcome });
        expectNothingWritten(before);
    });

    it.each([
        ['voided', 'voided'],
        ['processing', 'submitting'],
    ])('a %s form is refused with its reason, writing nothing', async (status, word) => {
        seed();
        await openOnThankYouPage();
        mockUpdate(REQUEST, { status });
        const before = [...mockDocs.entries()];

        await expect(send()).rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringContaining(word) });
        expectNothingWritten(before);
    });
});

describe('who may send what', () => {
    it('asks for company access first, and writes nothing when it is refused', async () => {
        seed();
        const { HttpsError } = require('firebase-functions/v2/https');
        assertCompanyAccessForRequest.mockRejectedValueOnce(new HttpsError('permission-denied', 'You do not have access to this company.'));
        const before = [...mockDocs.entries()];

        await expect(send()).rejects.toMatchObject({ code: 'permission-denied' });
        expect(assertCompanyAccessForRequest).toHaveBeenCalledWith(expect.anything(), 'co-1', 'sendPostApplicationDocument');
        expectNothingWritten(before);
    });

    it('sends only a form in the company\'s post-application list', async () => {
        seed({ forms: [{ templateId: 'tpl-2', enabled: true }, { templateId: 'tpl-1', enabled: false }] });
        const before = [...mockDocs.entries()];

        await expect(send()).rejects.toMatchObject({ code: 'failed-precondition' });
        expectNothingWritten(before);
    });

    it('accepts the list\'s older spelling, a bare template id', async () => {
        seed({ forms: ['tpl-1'] });
        await expect(send()).resolves.toMatchObject({ outcome: 'sent' });
    });

    it('finds the application only under the company named', async () => {
        seed();
        mockDocs.set('companies/co-2/applications/app-1', mockDocs.get(APPLICATION));
        mockDocs.delete(APPLICATION);
        const before = [...mockDocs.entries()];

        await expect(send()).rejects.toMatchObject({ code: 'not-found' });
        expectNothingWritten(before);
    });

    it.each(['companyId', 'applicationId', 'templateId'])('refuses a request without %s', async (name) => {
        seed();
        await expect(send({ [name]: '' })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(assertCompanyAccessForRequest).not.toHaveBeenCalled();
    });

    it('names the company as the sender when the team member has no name', async () => {
        seed();
        await send({}, { uid: 'user-2', token: { email: 'staff@example.test' } });
        expect(current()).toMatchObject({ senderId: 'user-2', senderName: 'Demo Logistics' });
    });
});
