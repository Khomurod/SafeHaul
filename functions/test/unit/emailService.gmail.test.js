/**
 * `sendDynamicEmail`, which every company email goes through, for a company
 * that connected Gmail: it sends through Gmail, from the Gmail address with
 * the company's name and signature, and never through the SMTP settings the
 * company keeps for a disconnect, also when Gmail fails. A company that
 * disconnects sends through SMTP again. The harness is
 * `gmailSending.support.js`; no SMTP server is contacted, and every value is
 * artificial.
 */
jest.mock('../../firebaseAdmin', () => require('./gmailSending.support').firebaseAdminMock());
jest.mock('../../shared/secretStore', () => ({ readLatestSecret: jest.fn() }));

const nodemailer = require('nodemailer');
const { sendDynamicEmail } = require('../../emailService');
const {
    COMPANY_NAME, EMAIL_CONFIG, GMAIL, SECRETS_AND_ADDRESSES, gmailConfig, gmailError, google, loggedText, mock,
    rawUpload, resetGmailSending, uploads,
} = require('./gmailSending.support');

const realCreateTransport = nodemailer.createTransport;
/** SMTP connections opened, each a double that records its emails. */
const smtpTransports = [];

/** A company of its own per case: the SMTP connections are kept for the process. */
function seedCompany(companyId, emailConfig) {
    mock.docs.set(`companies/${companyId}`, { companyName: COMPANY_NAME });
    mock.docs.set(EMAIL_CONFIG(companyId), emailConfig);
}

const send = (companyId) => sendDynamicEmail(companyId, 'dana.driver@example.test', 'Please sign', '<p>Sign here</p>');

beforeEach(() => {
    resetGmailSending();
    smtpTransports.length = 0;
    jest.spyOn(nodemailer, 'createTransport').mockImplementation((options) => {
        // The Gmail transport is a Nodemailer plugin (it has `send`): the real one builds its messages.
        if (typeof options?.send === 'function') return realCreateTransport(options);
        const transport = { options, sendMail: jest.fn(async () => ({ messageId: '<smtp@example.test>' })), close: jest.fn() };
        smtpTransports.push(transport);
        return transport;
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('a company that connected Gmail', () => {
    it('sends through Gmail, from the Gmail address, with its name and signature', async () => {
        seedCompany('co-g1', gmailConfig());

        await expect(send('co-g1')).resolves.toEqual({ success: true, messageId: expect.stringMatching(/^<.+>$/), from: GMAIL });

        expect(smtpTransports).toEqual([]);
        expect(uploads()).toHaveLength(1);
        const raw = rawUpload();
        expect(raw).toMatch(/^From: "?Artificial Freight LLC"? <hiring@example\.test>/m);
        expect(raw).toMatch(/^To: dana\.driver@example\.test/m);
        // Quoted-printable: a soft line break may split the signature.
        expect(raw.replace(/=\r?\n/g, '')).toContain('Regards, Artificial Freight');
    });

    it('never falls back to its SMTP settings when Gmail fails', async () => {
        seedCompany('co-g2', gmailConfig());
        google.refreshAnswers.push({ status: 400, body: { error: 'invalid_grant' } });

        const error = await send('co-g2').catch((caught) => caught);

        expect(error).toMatchObject({
            code: 'GMAIL_RECONNECT_NEEDED',
            message: 'Failed to send email: Gmail needs reconnecting: a company admin can reconnect it in Settings → Email.',
        });
        expect(smtpTransports).toEqual([]);
        expect(mock.docs.get(EMAIL_CONFIG('co-g2')).gmailStatus).toBe('needs_reconnect');
    });

    it('fails at once once Gmail needs reconnecting, instead of saying email is not set up', async () => {
        seedCompany('co-g3', gmailConfig({ gmailStatus: 'needs_reconnect', gmailStatusReason: 'invalid_grant' }));

        await expect(send('co-g3')).rejects.toMatchObject({
            code: 'GMAIL_RECONNECT_NEEDED',
            message: expect.stringContaining('Gmail needs reconnecting'),
        });
        expect(google.requests).toEqual([]);
        expect(smtpTransports).toEqual([]);
    });

    it("fails with Gmail's limit message and leaves the connection active", async () => {
        seedCompany('co-g4', gmailConfig());
        google.sendAnswers.push(gmailError(429, 'rateLimitExceeded'));

        await expect(send('co-g4')).rejects.toMatchObject({
            code: 'GMAIL_RATE_LIMITED',
            message: "Failed to send email: Gmail's sending limit was reached; try again later.",
        });
        expect(mock.docs.get(EMAIL_CONFIG('co-g4')).gmailStatus).toBe('active');
    });

    it('closes the SMTP connection it used before Gmail was connected, and never uses it again', async () => {
        const smtpOnly = { ...gmailConfig() };
        for (const field of Object.keys(smtpOnly)) if (field === 'provider' || field.startsWith('gmail')) delete smtpOnly[field];
        seedCompany('co-g5', smtpOnly);
        await send('co-g5');
        expect(smtpTransports).toHaveLength(1);
        expect(smtpTransports[0].options).toMatchObject({ host: 'smtp.example.test', pool: true });

        mock.docs.set(EMAIL_CONFIG('co-g5'), gmailConfig());
        await send('co-g5');

        expect(smtpTransports[0].close).toHaveBeenCalledTimes(1);
        expect(smtpTransports[0].sendMail).toHaveBeenCalledTimes(1);
        expect(uploads()).toHaveLength(1);
    });

    it('sends through SMTP again once Gmail is disconnected', async () => {
        seedCompany('co-g6', gmailConfig());
        await send('co-g6');
        expect(uploads()).toHaveLength(1);

        // What `disconnectGmail` leaves: the SMTP settings, no provider, no Gmail fields.
        const disconnected = { ...gmailConfig() };
        for (const field of Object.keys(disconnected)) if (field === 'provider' || field.startsWith('gmail')) delete disconnected[field];
        mock.docs.set(EMAIL_CONFIG('co-g6'), { ...disconnected, gmailDisconnectedAt: 'now', gmailDisconnectedBy: 'admin-1' });
        await expect(send('co-g6')).resolves.toMatchObject({ success: true, from: 'ops@example.test' });

        expect(smtpTransports).toHaveLength(1);
        expect(smtpTransports[0].options).toMatchObject({ auth: { user: 'ops@example.test', pass: 'artificial-smtp-password' } });
        expect(smtpTransports[0].sendMail.mock.calls[0][0].from).toBe(`"${COMPANY_NAME}" <ops@example.test>`);
        expect(uploads()).toHaveLength(1);
    });

    it('logs the company, never the recipient, the Gmail address or a token', async () => {
        seedCompany('co-g7', gmailConfig());
        await send('co-g7');
        google.sendAnswers.push(gmailError(400, 'invalidArgument'));
        await expect(send('co-g7')).rejects.toBeDefined();

        const logged = loggedText();
        expect(logged).toContain('co-g7');
        expect(logged).toContain('GMAIL_REJECTED');
        for (const secret of [...SECRETS_AND_ADDRESSES, 'dana.driver']) expect(logged).not.toContain(secret);
    });
});
