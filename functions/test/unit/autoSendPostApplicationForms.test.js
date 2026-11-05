/**
 * The automatic send after submission: every 15 minutes, an application a
 * driver submitted through the public form 30 minutes to 2 hours ago gets each
 * of the company's required post-application forms it has not dealt with on
 * the thank-you page, by Send to driver's rules (`shared/postApplicationSend.js`).
 *
 * The job runs against the store the signing-reminder suites run on
 * (`signingRequestStore.support.js`): transactions apply their writes only
 * when they succeed and run again when a document they read has changed since,
 * as Firestore's do. After a run, the events its writes cause are delivered to
 * the real triggers (`notifySigner`, `notifySignerSMS`,
 * `resendSignerOnCorrection`), so "one email" is checked on what is sent. Only
 * `Date` runs on a fake clock. All names, addresses and numbers are artificial.
 */
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_opts, fn) => fn }));
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
jest.mock('../../firebaseAdmin', () => require('./signingRequestStore.support').firebaseAdminMock());
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAccessForRequest: jest.fn() }));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn() }));
const mockSendEmail = jest.fn();
jest.mock('../../emailService', () => ({ sendDynamicEmail: (...args) => mockSendEmail(...args) }));
const mockSendSms = jest.fn();
jest.mock('../../integrations/factory', () => ({
    getAdapterForUser: async () => ({ sendSMS: (...args) => mockSendSms(...args) }),
}));

const store = require('./signingRequestStore.support');
const { db } = require('../../firebaseAdmin');
const { autoSendPostApplicationForms } = require('../../autoSendPostApplicationForms');
const { createPostApplicationSigningRequest } = require('../../postApplicationEdocs');
const { sendPostApplicationDocument } = require('../../sendPostApplicationDocument');
const { notifySigner } = require('../../notifySigner');
const { notifySignerSMS } = require('../../notifySignerSMS');
const { resendSignerOnCorrection } = require('../../resendSignerOnCorrection');
const { assertCompanyAccessForRequest } = require('../../shared/companyAccess');
const { checkRateLimit } = require('../../shared/rateLimiter');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 5, 17, 0);
const COMPANY = 'companies/co-1';
const REQUEST_ID = 'postapp_app-1_tpl-1';
const REQUEST = `${COMPANY}/signing_requests/${REQUEST_ID}`;
const TOKEN = `${REQUEST}/secrets/token`;
const SYSTEM = 'system:post-application';
const SSN = '123-45-6789';

const W9 = { templateId: 'tpl-1', title: 'W-9', enabled: true, required: true };
const HANDBOOK = { templateId: 'tpl-2', title: 'Handbook', enabled: true, required: false };
const OFFER = { templateId: 'tpl-3', title: 'Offer', enabled: true, required: true };

/** An application submitted through the public form, as `submitGuestApplication` writes it. */
function submitted(ago, extra = {}) {
    return {
        confirmationNumber: 'SAF-2026-ABCDE',
        firstName: 'Dana',
        lastName: 'Driver',
        email: 'dana@example.test',
        phone: '(555) 555-0100',
        'sms-consent': 'no',
        ssn: SSN,
        companyId: 'co-1',
        companyName: 'Demo Logistics',
        status: 'New Application',
        sourceType: 'Public Application',
        submittedAt: { ms: NOW - ago },
        createdAt: { ms: NOW - ago },
        lifecycle: { status: 'submitted', submittedAt: new Date(NOW - ago).toISOString(), isGuest: true, processedViaFunction: true },
        ...extra,
    };
}

const template = (title) => ({
    title,
    storagePath: `secure_documents/co-1/templates/${title}.pdf`,
    fields: [
        { id: 'name', type: 'text', required: true, prefillPolicy: 'locked', bindingKey: 'full_name', defaultValue: '' },
        { id: 'tax', type: 'text', required: false, defaultValue: '{{ssn}}' },
        { id: 'sig', type: 'signature', required: true, defaultValue: '' },
    ],
});

function seed({
    companyId = 'co-1', company = {}, forms = [W9], applications = { 'app-1': submitted(45 * MINUTE) },
} = {}) {
    const path = `companies/${companyId}`;
    store.docs.set(path, { companyName: 'Demo Logistics', features: { eDocs: true }, postApplicationTemplates: forms, ...company });
    store.docs.set(`public_profiles/${companyId}`, { companyName: 'Demo Logistics', postApplicationTemplates: forms });
    for (const form of [W9, HANDBOOK, OFFER]) {
        store.docs.set(`${path}/templates/${form.templateId}`, template(form.title));
    }
    for (const [id, application] of Object.entries(applications)) {
        store.docs.set(`${path}/applications/${id}`, structuredClone({ ...application, companyId }));
    }
}

const current = (path = REQUEST) => store.docs.get(path);
const everything = () => structuredClone([...store.docs.entries()]);
const emailedTo = () => mockSendEmail.mock.calls.map(([, to]) => to);
const later = (ms) => jest.setSystemTime(Date.now() + ms);

/** Every signing request in the store, by path. */
function requests() {
    return new Map([...store.docs.entries()]
        .filter(([path]) => /^companies\/[^/]+\/signing_requests\/[^/]+$/.test(path))
        .map(([path, data]) => [path, structuredClone(data)]));
}

/**
 * Delivers to the real triggers the events that the writes since `before`
 * (`requests()`) cause, as Firestore would: a new request to the creation
 * triggers, a changed one to the correction trigger.
 */
async function deliverSince(before) {
    for (const [path, data] of requests()) {
        const prior = before.get(path);
        if (prior !== undefined && JSON.stringify(prior) === JSON.stringify(data)) continue;
        const [, companyId, , requestId] = path.split('/');
        const params = { companyId, requestId };
        const ref = store.ref(path);
        if (prior === undefined) {
            const created = store.revive(data);
            await notifySigner({ data: () => created, ref }, { params });
            await notifySignerSMS({ id: `create-${requestId}`, params, data: { data: () => created, ref } });
        } else {
            await resendSignerOnCorrection({
                id: `update-${requestId}-${Date.now()}`,
                params,
                data: { before: { data: () => store.revive(prior) }, after: { data: () => store.revive(data), ref } },
            });
        }
    }
}

/** One run of the job, and what Firestore then delivers to the triggers. */
async function run() {
    const before = requests();
    await autoSendPostApplicationForms({});
    await deliverSince(before);
}

/** The driver opening a form on the thank-you page, right after submitting. */
const openOnThankYouPage = (templateId = 'tpl-1') => createPostApplicationSigningRequest({
    data: {
        companyId: 'co-1',
        applicationId: 'app-1',
        confirmationNumber: 'SAF-2026-ABCDE',
        templateId,
        appBaseUrl: 'https://truckerapp-system.web.app',
    },
    rawRequest: { ip: '203.0.113.10' },
});

/** The job's own log lines. */
function jobLogs() {
    return ['log', 'warn', 'error']
        .flatMap((level) => console[level].mock.calls)
        .map((args) => args.map(String).join(' '))
        .filter((line) => line.startsWith('[autoSendPostApplicationForms]'));
}

/** The last run's closing line: its counts and what it skipped, and why. */
const summary = () => jobLogs().filter((line) => line.startsWith('[autoSendPostApplicationForms] companies=')).at(-1);

beforeEach(() => {
    jest.resetAllMocks();
    store.reset();
    jest.useFakeTimers({
        now: NOW,
        doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate',
            'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
    mockSendEmail.mockResolvedValue(undefined);
    mockSendSms.mockResolvedValue(undefined);
    assertCompanyAccessForRequest.mockResolvedValue(undefined);
    checkRateLimit.mockResolvedValue(true);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('an application the driver submitted 45 minutes ago, with one required form', () => {
    it('gets the form by email once, from the company, made by the system', async () => {
        seed();

        await run();

        expect(emailedTo()).toEqual(['dana@example.test']);
        const [companyId, , subject, html] = mockSendEmail.mock.calls[0];
        expect(companyId).toBe('co-1');
        expect(subject).toBe('Action Required: Please Sign "W-9"');
        expect(html).toContain(`/sign/co-1/${REQUEST_ID}?token=${store.docs.get(TOKEN).accessToken}`);
        expect(html).toContain('<strong>Requested by:</strong> Demo Logistics');
        expect(mockSendSms).not.toHaveBeenCalled();

        expect(current()).toMatchObject({
            companyId: 'co-1',
            templateId: 'tpl-1',
            sourceApplicationId: 'app-1',
            sourceConfirmationNumber: 'SAF-2026-ABCDE',
            source: 'post_application_auto',
            status: 'sent',
            recipientName: 'Dana Driver',
            recipientEmail: 'dana@example.test',
            sendEmail: true,
            sendSms: false,
            deliveryMethod: 'email',
            senderId: SYSTEM,
            senderName: 'Demo Logistics',
            linkSentTo: { email: 'dana@example.test' },
            emailStatus: 'sent',
        });
        expect(current().fields.find((f) => f.id === 'name').defaultValue).toBe('Dana Driver');
        expect(JSON.stringify(current())).not.toContain(SSN);
        expect(current().accessToken).toBeUndefined();
    });

    it('is not sent again by the next run in the window, which writes nothing', async () => {
        seed();
        await run();
        mockSendEmail.mockClear();
        later(15 * MINUTE);
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
        expect(summary()).toContain('already-sent=1');
    });

    it('is sent once when two runs overlap', async () => {
        seed();
        const before = requests();

        // Whichever decides second finds the request the first made: the store
        // runs a transaction whose reads went stale again, as Firestore does.
        await Promise.all([autoSendPostApplicationForms({}), autoSendPostApplicationForms({})]);
        await deliverSince(before);

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(current().source).toBe('post_application_auto');
    });

    it('is texted too only after the driver answered Yes to texts, from the company', async () => {
        seed({ applications: { 'app-1': submitted(45 * MINUTE, { 'sms-consent': 'yes' }) } });

        await run();

        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendSms).toHaveBeenCalledTimes(1);
        const [phone, message, senderId] = mockSendSms.mock.calls[0];
        expect(phone).toBe('(555) 555-0100');
        expect(message).toContain('Demo Logistics sent you "W-9" to sign');
        expect(senderId).toBe(SYSTEM);
        expect(current()).toMatchObject({ sendEmail: true, sendSms: true, deliveryMethod: 'both' });
    });

    it('is emailed only when the driver\'s number opted out of texts', async () => {
        seed({ applications: { 'app-1': submitted(45 * MINUTE, { 'sms-consent': 'yes' }) } });
        store.docs.set(`${COMPANY}/blacklist/+15555550100`, { reason: 'STOP keyword' });

        await run();

        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendSms).not.toHaveBeenCalled();
        expect(current()).toMatchObject({ sendEmail: true, sendSms: false });
    });
});

describe('which forms', () => {
    it('sends each required form, never an optional or a switched-off one', async () => {
        seed({ forms: [W9, HANDBOOK, { ...OFFER, enabled: false }] });

        await run();

        expect(emailedTo()).toEqual(['dana@example.test']);
        expect([...requests().keys()]).toEqual([REQUEST]);
    });

    it('sends a form the driver opened on the thank-you page but did not sign, once, with its link', async () => {
        seed();
        await openOnThankYouPage();
        expect(current()).toMatchObject({ sendEmail: false, source: 'post_application_success' });
        const pageToken = store.docs.get(TOKEN).accessToken;

        await run();

        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendEmail.mock.calls[0][3]).toContain(`?token=${pageToken}`);
        expect(current()).toMatchObject({
            // What the request is stays the page's.
            source: 'post_application_success',
            sendEmail: true,
            deliveryMethod: 'email',
            senderId: SYSTEM,
            senderName: 'Demo Logistics',
            linkSentTo: { email: 'dana@example.test' },
        });

        later(15 * MINUTE);
        await run();
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['signed on the thank-you page', 'signed'],
        ['being sealed after signing', 'pending_seal'],
        ['being submitted right now', 'processing'],
        ['voided by the team', 'voided'],
    ])('does not send a form %s', async (_how, status) => {
        seed();
        await openOnThankYouPage();
        store.update(REQUEST, { status });
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockSendSms).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
    });

    it('does not send again a form the team already sent with Send to driver', async () => {
        seed();
        const before = requests();
        await sendPostApplicationDocument({
            auth: { uid: 'user-1', token: { name: 'Rita Recruiter' } },
            data: { companyId: 'co-1', applicationId: 'app-1', templateId: 'tpl-1' },
        });
        await deliverSince(before);
        mockSendEmail.mockClear();
        const sent = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(sent);
        expect(current()).toMatchObject({ source: 'post_application_team', senderId: 'user-1' });
    });

    it('skips a form whose template cannot be filled, logged by id and reason, and still sends the others', async () => {
        seed({ forms: [W9, OFFER] });
        store.docs.delete(`${COMPANY}/templates/tpl-1`);

        await run();

        expect(emailedTo()).toEqual(['dana@example.test']);
        expect([...requests().keys()]).toEqual([`${COMPANY}/signing_requests/postapp_app-1_tpl-3`]);
        expect(jobLogs().some((line) => line.includes('applicationId=app-1 templateId=tpl-1') && line.includes('not-found'))).toBe(true);
    });
});

describe('which applications', () => {
    it.each([
        ['10 minutes ago, while the driver may still be on the thank-you page', 10 * MINUTE],
        ['29 minutes ago', 29 * MINUTE],
        ['2 hours and a minute ago', 2 * HOUR + MINUTE],
        ['3 hours ago', 3 * HOUR],
        ['yesterday', DAY],
    ])('one submitted %s gets nothing', async (_when, ago) => {
        seed({ applications: { 'app-1': submitted(ago) } });
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
    });

    it.each([
        ['30 minutes ago', 30 * MINUTE],
        ['2 hours ago', 2 * HOUR],
    ])('one submitted %s, at the edge of the window, gets its form', async (_when, ago) => {
        seed({ applications: { 'app-1': submitted(ago) } });

        await run();

        expect(emailedTo()).toEqual(['dana@example.test']);
    });

    it('a record the team made, or one written outside the public form, gets nothing', async () => {
        const { lifecycle, ...byHand } = submitted(45 * MINUTE);
        seed({
            applications: {
                'app-1': { ...byHand, sourceType: 'Manual Entry' },
                'app-2': submitted(45 * MINUTE, { lifecycle: { ...lifecycle, processedViaFunction: undefined, isGuest: false } }),
            },
        });
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
    });

    it('a lead gets nothing, and leads are not read', async () => {
        seed({ applications: {} });
        store.docs.set(`${COMPANY}/leads/lead-1`, submitted(45 * MINUTE));
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
        expect(store.queried).not.toContain(`${COMPANY}/leads`);
    });

    it('one with no usable email and no Yes to texts gets nothing, logged by id and reason', async () => {
        seed({ applications: { 'app-1': submitted(45 * MINUTE, { email: 'dana@placeholder.safehaulapp.com', 'sms-consent': 'no' }) } });
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockSendSms).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
        expect(jobLogs()).toContain('[autoSendPostApplicationForms] companyId=co-1 applicationId=app-1 templateId=tpl-1 outcome=no-channel');
        expect(summary()).toContain('no-channel=1');
    });

    it('one whose driver said Yes to texts and has no usable email is texted only', async () => {
        seed({ applications: { 'app-1': submitted(45 * MINUTE, { email: '', 'sms-consent': 'Yes' }) } });

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockSendSms).toHaveBeenCalledTimes(1);
        expect(current()).toMatchObject({ sendEmail: false, sendSms: true, deliveryMethod: 'sms' });
    });
});

describe('which companies', () => {
    it('one that turned E-Docs off has nothing read or sent; one that did not gets its forms', async () => {
        seed({ company: { features: { eDocs: false } } });
        seed({ companyId: 'co-2', company: { features: { pev: false } } });

        await run();

        expect(store.queried).not.toContain(`${COMPANY}/applications`);
        expect(mockSendEmail.mock.calls.map(([companyId]) => companyId)).toEqual(['co-2']);
        expect(requests().has(REQUEST)).toBe(false);
    });

    it.each([
        ['switched off', { isActive: false }],
        ['suspended', { status: 'suspended' }],
    ])('one Super Admin %s has nothing read or sent', async (_how, company) => {
        seed({ company });
        const before = everything();

        await run();

        expect(store.queried).not.toContain(`${COMPANY}/applications`);
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
    });

    it('one with no required form has no applications read', async () => {
        seed({ forms: [HANDBOOK] });

        await run();

        expect(store.queried).not.toContain(`${COMPANY}/applications`);
        expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('one whose applications cannot be read does not stop the others, and is logged by id', async () => {
        seed();
        seed({ companyId: 'co-2' });
        store.failingQueries.add(`${COMPANY}/applications`);

        await run();

        expect(mockSendEmail.mock.calls.map(([companyId]) => companyId)).toEqual(['co-2']);
        expect(jobLogs().some((line) => line.includes('companyId=co-1') && line.includes('14'))).toBe(true);
        expect(summary()).toContain('errors=1');
    });
});

describe('one run', () => {
    it('out of time, starts no more sends, oldest first, and the next run sends the rest', async () => {
        seed({ applications: { 'app-1': submitted(45 * MINUTE), 'app-2': submitted(100 * MINUTE) } });
        const transaction = db.runTransaction;
        jest.spyOn(db, 'runTransaction').mockImplementationOnce(async (fn) => {
            const result = await transaction(fn);
            later(5 * MINUTE);
            return result;
        });

        await run();

        // The oldest goes first: it leaves the window soonest.
        expect([...requests().keys()]).toEqual([`${COMPANY}/signing_requests/postapp_app-2_tpl-1`]);
        expect(summary()).toContain('out of time');

        later(10 * MINUTE);
        await run();

        expect(mockSendEmail).toHaveBeenCalledTimes(2);
        expect(requests().has(REQUEST)).toBe(true);
    });

    it('reads applications on a single field, which Firestore indexes by itself', async () => {
        seed();

        await run();

        const read = store.queries.filter(({ path }) => path === `${COMPANY}/applications`);
        expect(read).toEqual([{ path: `${COMPANY}/applications`, fields: ['submittedAt'] }]);
        const { fieldOverrides = [] } = require('../../../firestore.indexes.json');
        expect(fieldOverrides.filter((o) => o.collectionGroup === 'applications' && o.fieldPath === 'submittedAt')).toEqual([]);
    });

    it('logs ids, counts and reasons, never a token, an address, a number or a name', async () => {
        seed({
            applications: {
                'app-1': submitted(45 * MINUTE, { 'sms-consent': 'yes' }),
                'app-2': submitted(50 * MINUTE, { email: '', 'sms-consent': 'no' }),
            },
        });

        await run();

        const lines = jobLogs();
        expect(lines).toContain(`[autoSendPostApplicationForms] companyId=co-1 applicationId=app-1 templateId=tpl-1 requestId=${REQUEST_ID} outcome=sent email=true sms=true`);
        expect(summary()).toBe('[autoSendPostApplicationForms] companies=1 applications=2 sent=1 errors=0 skipped: no-channel=1');
        const token = store.docs.get(TOKEN).accessToken;
        for (const line of lines) {
            expect(line).not.toContain(token);
            expect(line).not.toMatch(/dana@|555|Dana|Driver|SAF-2026|Demo Logistics/);
        }
    });
});
