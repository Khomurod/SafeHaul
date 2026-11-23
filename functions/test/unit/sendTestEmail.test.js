/**
 * "Send test email" (`sendTestEmail`): a company admin checks the company's
 * email with what every other email is sent with, the connected Gmail or else
 * the SMTP settings. It goes only to the caller's own sign-in address, five an
 * hour per company, and a failure answers a plain message. The harness is
 * `gmailSending.support.js`; no mail server is contacted, and every value is
 * artificial.
 */
jest.mock('firebase-functions/v2/https', () => require('./gmailSending.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./gmailSending.support').firebaseAdminMock());
jest.mock('../../shared/secretStore', () => ({ readLatestSecret: jest.fn() }));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn() }));
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAdminStrict: jest.fn() }));

const nodemailer = require('nodemailer');
const { sendTestEmail } = require('../../sendTestEmail');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAdminStrict } = require('../../shared/companyAccess');
const {
    COMPANY, EMAIL_CONFIG, GMAIL, SECRETS_AND_ADDRESSES, gmailConfig, gmailError, google, loggedText, mock,
    rawUpload, resetGmailSending, uploads,
} = require('./gmailSending.support');

const ADMIN_EMAIL = 'anna.admin@example.test';
const realCreateTransport = nodemailer.createTransport;
const smtpTransports = [];

const call = ({ uid = 'admin-1', email = ADMIN_EMAIL, data = { companyId: COMPANY } } = {}) => sendTestEmail({
    auth: uid ? { uid, token: email === null ? {} : { email } } : undefined,
    data,
});

/** The company's settings with Gmail's fields gone, as a company that never connected it keeps them. */
function smtpOnly() {
    const settings = { ...gmailConfig() };
    for (const field of Object.keys(settings)) if (field === 'provider' || field.startsWith('gmail')) delete settings[field];
    return settings;
}

beforeEach(() => {
    resetGmailSending();
    smtpTransports.length = 0;
    checkRateLimit.mockImplementation(async () => true);
    assertCompanyAdminStrict.mockImplementation(async (_uid, companyId) => mock.db.collection('companies').doc(companyId).get());
    jest.spyOn(nodemailer, 'createTransport').mockImplementation((options) => {
        if (typeof options?.send === 'function') return realCreateTransport(options);
        const transport = { options, sendMail: jest.fn(async () => ({ messageId: '<smtp@example.test>' })), close: jest.fn() };
        smtpTransports.push(transport);
        return transport;
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('who may send one', () => {
    it('refuses a signed-out caller', async () => {
        await expect(call({ uid: null })).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(google.requests).toEqual([]);
    });

    it.each([undefined, '', 'co-1/other', 42])('refuses a missing or unusable company id (%p)', async (companyId) => {
        await expect(call({ data: { companyId } })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it("refuses anyone the company admin check refuses, before using the company's hourly tests", async () => {
        assertCompanyAdminStrict.mockImplementation(async () => {
            throw Object.assign(new Error('You do not have access to this company.'), { code: 'permission-denied' });
        });

        await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
        expect(checkRateLimit).not.toHaveBeenCalled();
        expect(google.requests).toEqual([]);
    });

    it('allows five an hour per company', async () => {
        checkRateLimit.mockImplementation(async () => false);

        await expect(call()).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(checkRateLimit).toHaveBeenCalledWith(`send_test_email_${COMPANY}`, 5, 3600, 'closed');
        expect(google.requests).toEqual([]);
    });

    it("refuses a sign-in without an email address, without using up the company's hourly tests", async () => {
        await expect(call({ email: null })).rejects.toMatchObject({ code: 'failed-precondition' });
        await expect(call({ email: 'not-an-address' })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(checkRateLimit).not.toHaveBeenCalled();
        expect(google.requests).toEqual([]);
    });
});

describe('a company that connected Gmail', () => {
    it("sends the test through Gmail to the caller's own address", async () => {
        await expect(call()).resolves.toEqual({ sent: true, to: ADMIN_EMAIL, from: GMAIL });

        expect(uploads()).toHaveLength(1);
        expect(rawUpload()).toMatch(/^To: anna\.admin@example\.test/m);
        expect(rawUpload()).toMatch(/^Subject: SafeHaul test email/m);
        expect(smtpTransports).toEqual([]);
    });

    it('never sends to an address the caller names', async () => {
        await call({ data: { companyId: COMPANY, to: 'someone.else@example.test', recipientEmail: 'someone.else@example.test' } });

        expect(rawUpload()).not.toContain('someone.else');
    });

    it.each([
        ['needs reconnecting', () => mock.docs.set(EMAIL_CONFIG(), gmailConfig({ gmailStatus: 'needs_reconnect' })),
            'failed-precondition', 'Gmail needs reconnecting: a company admin can reconnect it in Settings → Email.'],
        ['is refused by Google', () => google.refreshAnswers.push({ status: 400, body: { error: 'invalid_grant' } }),
            'failed-precondition', 'Gmail needs reconnecting: a company admin can reconnect it in Settings → Email.'],
        ['has reached its sending limit', () => google.sendAnswers.push(gmailError(429, 'rateLimitExceeded')),
            'resource-exhausted', "Gmail's sending limit was reached; try again later."],
        ['cannot be reached', () => google.sendAnswers.push('network'),
            'unavailable', 'Gmail could not be reached. Try again in a moment.'],
        ['is not set up on the server', () => require('../../shared/secretStore').readLatestSecret.mockImplementation(async () => null),
            'failed-precondition', 'Sending from Gmail is not set up yet.'],
    ])('answers a plain message when Gmail %s', async (_label, arrange, code, message) => {
        arrange();

        await expect(call()).rejects.toMatchObject({ code, message });
        expect(smtpTransports).toEqual([]);
    });
});

describe('a company that sends through SMTP', () => {
    it("sends the test through its mail server to the caller's own address", async () => {
        mock.docs.set(EMAIL_CONFIG(), smtpOnly());

        await expect(call()).resolves.toEqual({ sent: true, to: ADMIN_EMAIL, from: 'ops@example.test' });

        expect(google.requests).toEqual([]);
        expect(smtpTransports[0].sendMail).toHaveBeenCalledWith(expect.objectContaining({
            to: ADMIN_EMAIL,
            subject: 'SafeHaul test email',
            from: '"Artificial Freight LLC" <ops@example.test>',
        }));
    });

    it("answers a fixed message when the mail server refuses, never the server's own text", async () => {
        // A company of its own: SMTP connections are kept per company for the process.
        mock.docs.set('companies/co-smtp', { companyName: 'Artificial Freight LLC' });
        mock.docs.set(EMAIL_CONFIG('co-smtp'), smtpOnly());
        const refused = Object.assign(new Error(`Invalid login: 535 for ${ADMIN_EMAIL}`), { code: 'EAUTH', responseCode: 535 });
        nodemailer.createTransport.mockImplementation((options) => ({ options, sendMail: async () => { throw refused; }, close() {} }));

        const error = await call({ data: { companyId: 'co-smtp' } }).catch((caught) => caught);

        expect(error).toMatchObject({
            code: 'unavailable',
            message: 'The test email was not sent: your mail server did not accept it. Check the settings in Settings → Email.',
        });
        expect(error.message).not.toContain('535');
    });

    it('says email is not set up when the company has no settings', async () => {
        mock.docs.delete(EMAIL_CONFIG());

        await expect(call()).rejects.toMatchObject({
            code: 'failed-precondition',
            message: 'Email is not set up for your company. A company admin can set it up in Settings → Email.',
        });
    });
});

it('logs the company and the outcome, never an address or a token', async () => {
    await call();
    google.sendAnswers.push(gmailError(400, 'invalidArgument'));
    await expect(call()).rejects.toBeDefined();

    const logged = loggedText();
    expect(logged).toContain(COMPANY);
    expect(logged).toContain('GMAIL_REJECTED');
    for (const secret of [...SECRETS_AND_ADDRESSES, ADMIN_EMAIL, 'anna.admin']) expect(logged).not.toContain(secret);
});
