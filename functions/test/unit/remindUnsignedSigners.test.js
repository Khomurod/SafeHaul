/**
 * The automatic reminder: once a day, a document still waiting for its
 * signature three days after it was sent gets one reminder, by the same rules
 * as Remind (`shared/signerReminder.js`).
 *
 * The job runs against the store `remindSigner.test.js` runs on
 * (`signingRequestStore.support.js`): transactions apply their writes only
 * when they succeed and run again when a document they read has changed since,
 * as Firestore's do. The real senders (`emailSigningLink`, `textSigningLink`)
 * record on the request what they sent, so "once" is checked on what is sent.
 * Only `Date` runs on a fake clock. All names, addresses and numbers are
 * artificial.
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
const mockSendEmail = jest.fn();
jest.mock('../../emailService', () => ({ sendDynamicEmail: (...args) => mockSendEmail(...args) }));
const mockSendSms = jest.fn();
jest.mock('../../integrations/factory', () => ({
    getAdapterForUser: async () => ({ sendSMS: (...args) => mockSendSms(...args) }),
}));

const store = require('./signingRequestStore.support');
const { remindUnsignedSigners, AUTO_REMINDER_ACTOR } = require('../../remindUnsignedSigners');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 5, 17, 0);
const COMPANY = 'companies/co-1';
const REQUESTS = `${COMPANY}/signing_requests`;
const REQUEST = `${REQUESTS}/req-1`;
const TOKEN = `${REQUEST}/secrets/token`;
const APPLICATION = `${COMPANY}/applications/app-1`;
const LINK = 'https://truckerapp-system.web.app/sign/co-1/req-1?token=token-1';
const SYSTEM = 'system:auto-reminder';

/** A document a recruiter emailed three days and an hour ago, its link good for four more days. */
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
    emailSentAt: new Date(NOW - 3 * DAY - HOUR).toISOString(),
    createdAt: { ms: NOW - 3 * DAY - HOUR },
    expiresAt: { ms: NOW + 4 * DAY - HOUR },
};

function seed(request = EMAILED, { path = REQUEST, application, company = { companyName: 'Demo Logistics' } } = {}) {
    const companyPath = path.split('/').slice(0, 2).join('/');
    if (company && !store.docs.has(companyPath)) store.docs.set(companyPath, structuredClone(company));
    store.docs.set(path, structuredClone(request));
    store.docs.set(`${path}/secrets/token`, { accessToken: 'token-1' });
    if (application) store.docs.set(APPLICATION, structuredClone(application));
}

const run = () => remindUnsignedSigners({});
const current = (path = REQUEST) => store.docs.get(path);
const emailedTo = () => mockSendEmail.mock.calls.map(([, to]) => to);
const everything = () => structuredClone([...store.docs.entries()]);
const later = (ms) => jest.setSystemTime(Date.now() + ms);

/** The job's own log lines. */
function jobLogs() {
    return ['log', 'warn', 'error']
        .flatMap((level) => console[level].mock.calls)
        .map((args) => args.map(String).join(' '))
        .filter((line) => line.startsWith('[remindUnsignedSigners]'));
}

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
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('a document still waiting for its signature three days after it was sent', () => {
    it('is reminded once, by email, as the system, with seven more days on the same link', async () => {
        seed();

        await run();

        expect(emailedTo()).toEqual(['dana@example.test']);
        const [companyId, , subject, html] = mockSendEmail.mock.calls[0];
        expect(companyId).toBe('co-1');
        expect(subject).toBe('Reminder: Please Sign "Offer Letter"');
        expect(html).toContain(LINK);
        expect(html).toContain('still waiting for your signature');
        expect(mockSendSms).not.toHaveBeenCalled();

        const request = current();
        expect(AUTO_REMINDER_ACTOR).toBe(SYSTEM);
        expect(request.reminders).toEqual({ count: 1, lastAt: { ms: NOW }, lastBy: SYSTEM });
        expect(request.autoReminder).toEqual({ sentAt: { ms: NOW }, outcome: 'sent' });
        expect(store.docs.get(TOKEN)).toEqual({ accessToken: 'token-1' });
        expect(request.expiresAt).toEqual({ ms: NOW + 7 * DAY });
        expect(request).toMatchObject({ status: 'sent', emailStatus: 'sent', linkSentTo: { email: 'dana@example.test' } });
    });

    it('is not reminded again by the next run, which writes nothing', async () => {
        seed();
        await run();
        mockSendEmail.mockClear();
        later(DAY);
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
    });

    it('is reminded once when two runs overlap', async () => {
        seed();

        // Both read the document before either claims it: the store runs the
        // later transaction again, as Firestore does, and it finds the claim.
        await Promise.all([run(), run()]);

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(current().reminders.count).toBe(1);
    });

    it('is not reminded by a run that starts while another is still sending it', async () => {
        seed();
        let finishSend;
        mockSendEmail.mockImplementationOnce(() => new Promise((resolve) => { finishSend = resolve; }));

        const first = run();
        await waitUntil(() => finishSend);
        await run();
        finishSend();
        await first;

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(current().autoReminder.outcome).toBe('sent');
    });

    it('is reminded up to seven days after it was sent', async () => {
        seed({ ...EMAILED, createdAt: { ms: NOW - 7 * DAY + HOUR } });

        await run();

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });
});

describe('a document that is not reminded, and is not marked so', () => {
    it.each([
        ['today', 0],
        ['2 days and 23 hours ago', 3 * DAY - HOUR],
        ['8 days ago', 8 * DAY],
        ['31 days ago', 31 * DAY],
    ])('one sent %s', async (_when, age) => {
        seed({ ...EMAILED, createdAt: { ms: NOW - age } });
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
    });

    it.each(['signed', 'pending_seal', 'voided', 'processing'])('one that is %s', async (status) => {
        seed({ ...EMAILED, status });
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
    });

    it('one a team member reminded within the last day; the next run reminds it, once the day is over', async () => {
        const pressed = { count: 1, lastAt: { ms: NOW - 23 * HOUR }, lastBy: 'user-1' };
        seed({ ...EMAILED, reminders: pressed });
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);

        later(DAY);
        await run();

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(current().reminders).toEqual({ count: 2, lastAt: { ms: NOW + DAY }, lastBy: SYSTEM });
    });

    it.each([
        ['emailed', { emailSentAt: new Date(NOW - 5 * HOUR).toISOString() }],
        ['texted', { sendSms: true, smsSentAt: { ms: NOW - 2 * HOUR } }],
    ])('one whose link was %s again within the last day (a correction, Send to driver)', async (_how, sent) => {
        seed({ ...EMAILED, ...sent });
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockSendSms).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
    });

    it('one shared by a copied link, with nothing to send again', async () => {
        seed({ ...EMAILED, sendEmail: false, sendSms: false, deliveryMethod: 'copy', linkSentTo: {} });
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
    });

    it('one with no link at all', async () => {
        seed();
        store.docs.delete(TOKEN);
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
    });
});

describe('a company', () => {
    it('that turned E-Docs off has nothing read or sent; one that did not is reminded', async () => {
        seed(EMAILED, { company: { companyName: 'Demo Logistics', features: { eDocs: false } } });
        seed(EMAILED, { path: 'companies/co-2/signing_requests/req-2', company: { features: { eDocs: true, pev: false } } });
        const before = structuredClone(current());

        await run();

        expect(store.queried).not.toContain(REQUESTS);
        expect(current()).toEqual(before);
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockSendEmail.mock.calls[0][0]).toBe('co-2');
    });

    it('that Super Admin deactivated has nothing sent', async () => {
        seed(EMAILED, { company: { companyName: 'Demo Logistics', isActive: false } });
        const before = everything();

        await run();

        expect(store.queried).not.toContain(REQUESTS);
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
    });

    it('whose documents cannot be read does not stop the others, and is logged by id', async () => {
        seed();
        seed(EMAILED, { path: 'companies/co-2/signing_requests/req-2' });
        store.failingQueries.add(REQUESTS);

        await run();

        expect(mockSendEmail.mock.calls.map(([companyId]) => companyId)).toEqual(['co-2']);
        expect(jobLogs().some((line) => line.includes('companyId=co-1') && line.includes('14'))).toBe(true);
    });
});

describe('texts follow the signing-text rules', () => {
    const forApplication = { ...EMAILED, sourceApplicationId: 'app-1', sendSms: true, deliveryMethod: 'both' };

    it('an application\'s driver who did not answer Yes to texts is emailed only', async () => {
        seed(forApplication, { application: { 'sms-consent': 'no' } });

        await run();

        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendSms).not.toHaveBeenCalled();
        expect(current()).toMatchObject({ autoReminder: { outcome: 'sent' }, linkSentTo: { email: 'dana@example.test' } });
    });

    it('an application\'s driver who answered Yes is texted the reminder too', async () => {
        seed(forApplication, { application: { 'sms-consent': 'yes' } });

        await run();

        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendSms).toHaveBeenCalledWith(
            '(555) 555-0100',
            `📄 Reminder: Rita Recruiter sent you "Offer Letter" to sign. Sign here: ${LINK}`,
            'user-2',
        );
        expect(current()).toMatchObject({ smsStatus: 'sent', linkSentTo: { email: 'dana@example.test', phone: '+15555550100' } });
    });

    it('a document sent only by text, to a driver who did not answer Yes, is not reminded or marked', async () => {
        seed({ ...forApplication, sendEmail: false, deliveryMethod: 'sms', linkSentTo: { phone: '+15555550100' } }, { application: {} });
        const before = everything();

        await run();

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockSendSms).not.toHaveBeenCalled();
        expect(everything()).toEqual(before);
    });

    it('a number on the opt-out list is not texted, and the email still goes', async () => {
        seed({ ...EMAILED, sendSms: true, deliveryMethod: 'both' });
        store.docs.set(`${COMPANY}/blacklist/+15555550100`, { reason: 'STOP' });

        await run();

        expect(mockSendSms).not.toHaveBeenCalled();
        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(current()).toMatchObject({ smsStatus: 'failed', smsError: 'Not texted: this number opted out of texts.' });
    });
});

describe('a reminder whose send fails', () => {
    it('is recorded as failed, does not count as a reminder, and is not tried again', async () => {
        seed();
        mockSendEmail.mockRejectedValue(new Error('SMTP 535 authentication failed (artificial)'));

        await run();

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        const request = current();
        expect(request).toMatchObject({ emailStatus: 'failed', emailError: 'SMTP 535 authentication failed (artificial)' });
        expect(request.autoReminder).toEqual({ sentAt: { ms: NOW }, outcome: 'failed' });
        expect(request.reminders).toBeUndefined();

        later(DAY);
        await run();
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });

    it('that reached the signer one way counts as sent', async () => {
        seed({ ...EMAILED, sendSms: true, deliveryMethod: 'both' });
        mockSendEmail.mockRejectedValue(new Error('SMTP 535 authentication failed (artificial)'));

        await run();

        expect(mockSendSms).toHaveBeenCalledTimes(1);
        expect(current()).toMatchObject({ autoReminder: { outcome: 'sent' }, reminders: { count: 1 }, emailStatus: 'failed', smsStatus: 'sent' });
    });
});

describe('one run', () => {
    it('out of time, starts no more reminders, and the next run sends the rest', async () => {
        seed();
        seed({ ...EMAILED, createdAt: { ms: NOW - 4 * DAY } }, { path: `${REQUESTS}/req-2` });
        mockSendEmail.mockImplementationOnce(async () => later(8 * MINUTE));

        await run();

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        const untouched = ['req-1', 'req-2'].filter((id) => !current(`${REQUESTS}/${id}`).autoReminder);
        expect(untouched).toHaveLength(1);

        later(DAY);
        await run();

        expect(mockSendEmail).toHaveBeenCalledTimes(2);
        expect(current(`${REQUESTS}/${untouched[0]}`).autoReminder.outcome).toBe('sent');
    });

    it('logs ids and counts, never a token, an address or a number', async () => {
        seed({ ...EMAILED, sendSms: true, deliveryMethod: 'both' });

        await run();

        const lines = jobLogs();
        expect(lines.some((line) => line.includes('companyId=co-1 requestId=req-1'))).toBe(true);
        for (const line of lines) {
            expect(line).not.toMatch(/token-1|dana@|555/);
        }
    });
});

/** Waits a few turns of the event loop for `ready()` to hold. */
async function waitUntil(ready) {
    for (let turn = 0; turn < 100 && !ready(); turn += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    if (!ready()) throw new Error('never became ready');
}
