/**
 * Sending through a company's connected Gmail (`shared/gmail/gmailTransport.js`):
 * Nodemailer builds the message as for SMTP, and the whole message is uploaded
 * to Gmail with a short-lived access token kept in memory only.
 *
 * - the raw upload, its headers, a kept Bcc and an attachment;
 * - a 401 gets one fresh token and one retry;
 * - Gmail's sending limits fail as GMAIL_RATE_LIMITED and leave the status alone;
 * - a revoked grant (`invalid_grant`) or a lost send scope marks the Gmail
 *   `needs_reconnect`, with exactly one bell notice a day for that connection,
 *   and never undoes a reconnect made in the meantime;
 * - a Gmail already marked sends nothing and asks Google nothing;
 * - no log carries a token, an address or Google's text.
 *
 * The harness is `gmailSending.support.js`; every value is artificial.
 */
jest.mock('../../firebaseAdmin', () => require('./gmailSending.support').firebaseAdminMock());
jest.mock('../../shared/secretStore', () => ({ readLatestSecret: jest.fn() }));

const { gmailTokenFingerprint, readSmtpSettings, sealPassword } = require('../../shared/smtpSettings');
const { createGmailTransporter } = require('../../shared/gmail/gmailTransport');
const {
    COMPANY, COMPANY_NAME, EMAIL_CONFIG, GMAIL, REFRESH_TOKEN, SECRETS_AND_ADDRESSES, SEND_ENDPOINT, TOKEN_ENDPOINT,
    config, gmailConfig, gmailError, google, loggedText, mock, notices, rawUpload, refreshes, resetGmailSending, uploads,
} = require('./gmailSending.support');

const DAY = Date.parse('2026-11-23T15:00:00Z');

/** The bell notice's id for that day and the connection now stored. */
const noticeOn = (day) => `gmail_reconnect_${day}_${gmailTokenFingerprint(config().gmailRefreshToken).slice(0, 12)}`;

/** One email through the company's Gmail, with the settings the senders read. */
async function send(mail = {}) {
    const { settings } = await readSmtpSettings(COMPANY);
    return createGmailTransporter({ companyId: COMPANY, settings }).sendMail({
        from: `"${COMPANY_NAME}" <${settings.user}>`,
        to: 'dana.driver@example.test',
        subject: 'Your application',
        html: '<p>Hello</p>',
        ...mail,
    });
}

beforeEach(() => {
    resetGmailSending();
    jest.spyOn(Date, 'now').mockReturnValue(DAY);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('the upload', () => {
    it('posts the whole message to Gmail with the access token and message/rfc822', async () => {
        const info = await send();

        expect(refreshes()).toHaveLength(1);
        expect(Object.fromEntries(new URLSearchParams(refreshes()[0].init.body))).toMatchObject({
            grant_type: 'refresh_token',
            refresh_token: REFRESH_TOKEN,
        });
        expect(uploads()).toHaveLength(1);
        const { url, init } = uploads()[0];
        expect(url).toBe(SEND_ENDPOINT);
        expect(init.method).toBe('POST');
        expect(init.headers).toEqual({ 'Authorization': 'Bearer artificial-access-1', 'Content-Type': 'message/rfc822' });
        const raw = rawUpload();
        expect(raw).toMatch(/^From: "?Artificial Freight LLC"? <hiring@example\.test>/m);
        expect(raw).toMatch(/^To: dana\.driver@example\.test/m);
        expect(raw).toMatch(/^Subject: Your application/m);
        expect(raw).toContain('<p>Hello</p>');
        expect(info).toMatchObject({ gmailId: '18c0a1b2c3d4e5f6', envelope: { from: GMAIL, to: ['dana.driver@example.test'] } });
        expect(info.messageId).toMatch(/^<.+@example\.test>$/);
    });

    it('keeps the Bcc header, since Gmail reads the recipients from the headers', async () => {
        await send({ cc: 'sam.signer@example.test', bcc: 'records@example.test' });

        expect(rawUpload()).toMatch(/^Cc: sam\.signer@example\.test/m);
        expect(rawUpload()).toMatch(/^Bcc: records@example\.test/m);
    });

    it('carries an attachment, as a signed PDF is sent', async () => {
        const pdf = Buffer.from('%PDF-1.7 artificial signed copy');
        await send({ attachments: [{ filename: 'signed.pdf', content: pdf, contentType: 'application/pdf' }] });

        const raw = rawUpload();
        expect(raw).toMatch(/Content-Type: application\/pdf; name=signed\.pdf/);
        expect(raw.replace(/\r?\n/g, '')).toContain(pdf.toString('base64'));
    });

    it('keeps the access token in memory for the next email, and asks again once it is nearly spent', async () => {
        await send();
        await send();
        expect(refreshes()).toHaveLength(1);
        expect(uploads().map((upload) => upload.init.headers.Authorization)).toEqual(['Bearer artificial-access-1', 'Bearer artificial-access-1']);

        // 3,599 s granted; the last minute is not used.
        Date.now.mockReturnValue(DAY + (3599 - 59) * 1000);
        await send();
        expect(refreshes()).toHaveLength(2);
        expect(uploads()[2].init.headers.Authorization).toBe('Bearer artificial-access-2');
    });

    it('never stores the access token', async () => {
        await send();
        expect(JSON.stringify([...mock.docs.entries()])).not.toContain('artificial-access-');
    });

    it('asks once for two emails sent at the same moment', async () => {
        await Promise.all([send(), send()]);
        expect(refreshes()).toHaveLength(1);
        expect(uploads()).toHaveLength(2);
    });
});

describe('a token Gmail no longer accepts (401)', () => {
    it('gets one fresh access token and sends again', async () => {
        await send();
        google.sendAnswers.push(gmailError(401, 'authError'));

        await expect(send()).resolves.toMatchObject({ gmailId: '18c0a1b2c3d4e5f6' });

        expect(refreshes()).toHaveLength(2);
        expect(uploads().map((upload) => upload.init.headers.Authorization))
            .toEqual(['Bearer artificial-access-1', 'Bearer artificial-access-1', 'Bearer artificial-access-2']);
    });

    it('fails after the one retry, and leaves the connection as it is', async () => {
        google.sendAnswers.push(gmailError(401, 'authError'), gmailError(401, 'authError'));

        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_FAILED' });

        expect(uploads()).toHaveLength(2);
        expect(config().gmailStatus).toBe('active');
    });
});

describe("Gmail's sending limits", () => {
    it.each([
        ['a 429', gmailError(429, 'rateLimitExceeded')],
        ['a 403 rateLimitExceeded', gmailError(403, 'rateLimitExceeded')],
        ['a 403 userRateLimitExceeded', gmailError(403, 'userRateLimitExceeded')],
        ['a 403 dailyLimitExceeded', gmailError(403, 'dailyLimitExceeded')],
    ])('fail %s as GMAIL_RATE_LIMITED, with no status change and no notice', async (_label, answer) => {
        google.sendAnswers.push(answer);

        await expect(send()).rejects.toMatchObject({
            code: 'GMAIL_RATE_LIMITED',
            message: "Gmail's sending limit was reached; try again later.",
        });

        expect(uploads()).toHaveLength(1);
        expect(config().gmailStatus).toBe('active');
        expect(notices()).toEqual([]);
    });
});

describe('a grant Google no longer honours', () => {
    it('marks the Gmail as needing a reconnect, with the reason and the time, and fails with the plain message', async () => {
        const storedToken = config().gmailRefreshToken;
        google.refreshAnswers.push({ status: 400, body: { error: 'invalid_grant', error_description: `Token revoked for ${GMAIL}` } });

        await expect(send()).rejects.toMatchObject({
            code: 'GMAIL_RECONNECT_NEEDED',
            message: 'Gmail needs reconnecting: a company admin can reconnect it in Settings → Email.',
        });

        expect(uploads()).toEqual([]);
        expect(config()).toMatchObject({
            gmailStatus: 'needs_reconnect',
            gmailStatusReason: 'invalid_grant',
            gmailStatusAt: '__server_timestamp__',
            // The token stays until an admin reconnects or disconnects.
            gmailRefreshToken: storedToken,
        });
        expect(notices()).toEqual([noticeOn('2026-11-23')]);
        expect(mock.docs.get(`companies/${COMPANY}/notifications/${noticeOn('2026-11-23')}`)).toMatchObject({
            type: 'gmail_reconnect',
            title: 'Gmail needs reconnecting',
            read: false,
        });
    });

    it("records Google Workspace's block as admin_policy", async () => {
        google.refreshAnswers.push({ status: 400, body: { error: 'admin_policy_enforced' } });

        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });

        expect(config()).toMatchObject({ gmailStatus: 'needs_reconnect', gmailStatusReason: 'admin_policy' });
    });

    it('marks a lost send scope (403 insufficientPermissions) as insufficient_scope', async () => {
        google.sendAnswers.push(gmailError(403, 'insufficientPermissions'));

        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });

        expect(config()).toMatchObject({ gmailStatus: 'needs_reconnect', gmailStatusReason: 'insufficient_scope' });
        expect(notices()).toEqual([noticeOn('2026-11-23')]);
    });

    it('tells the team once a day, however many emails fail', async () => {
        google.refreshAnswers.push({ status: 400, body: { error: 'invalid_grant' } });
        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });
        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });
        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });
        expect(notices()).toEqual([noticeOn('2026-11-23')]);

        Date.now.mockReturnValue(DAY + 24 * 3600 * 1000);
        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });
        expect(notices()).toEqual([noticeOn('2026-11-23'), noticeOn('2026-11-24')]);
    });

    it('tells the team again when the Gmail breaks again after a reconnect the same day', async () => {
        google.refreshAnswers.push({ status: 400, body: { error: 'invalid_grant' } });
        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });
        const first = noticeOn('2026-11-23');

        // An admin reconnects (a new token, the status active again), and Google refuses that grant too.
        mock.docs.set(EMAIL_CONFIG(), gmailConfig({ gmailRefreshToken: sealPassword('artificial-refresh-token-new') }));
        google.refreshAnswers.push({ status: 400, body: { error: 'invalid_grant' } });
        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });

        expect(noticeOn('2026-11-23')).not.toBe(first);
        expect(notices().sort()).toEqual([first, noticeOn('2026-11-23')].sort());
    });

    it('tells the team once a day even across instances, by the notice id', async () => {
        const { _resetNoticesForTesting } = require('../../shared/gmail/gmailStatus');
        google.refreshAnswers.push({ status: 400, body: { error: 'invalid_grant' } });
        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });
        _resetNoticesForTesting();
        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });

        expect(notices()).toEqual([noticeOn('2026-11-23')]);
    });

    it('never undoes a reconnect made while the failing email was being sent', async () => {
        const { settings } = await readSmtpSettings(COMPANY);
        // An admin reconnects (a new token) between the read and Google's answer.
        mock.docs.set(EMAIL_CONFIG(), gmailConfig({ gmailRefreshToken: sealPassword('artificial-refresh-token-new') }));
        google.refreshAnswers.push({ status: 400, body: { error: 'invalid_grant' } });

        await expect(createGmailTransporter({ companyId: COMPANY, settings }).sendMail({
            from: GMAIL, to: 'dana.driver@example.test', subject: 'x', html: 'x',
        })).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });

        expect(config()).toMatchObject({ gmailStatus: 'active', gmailStatusReason: null });
        expect(notices()).toEqual([]);
    });

    it('never undoes a disconnect either', async () => {
        const { settings } = await readSmtpSettings(COMPANY);
        mock.docs.set(EMAIL_CONFIG(), { smtpHost: 'smtp.example.test', smtpUser: 'ops@example.test', smtpPass: 'x' });
        google.refreshAnswers.push({ status: 400, body: { error: 'invalid_grant' } });

        await expect(createGmailTransporter({ companyId: COMPANY, settings }).sendMail({
            from: GMAIL, to: 'dana.driver@example.test', subject: 'x', html: 'x',
        })).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });

        expect(config()).not.toHaveProperty('gmailStatus');
        expect(config()).not.toHaveProperty('provider');
    });
});

describe('a Gmail already marked as needing a reconnect', () => {
    it('sends nothing, asks Google nothing, and still tells the team today', async () => {
        mock.docs.set(EMAIL_CONFIG(), gmailConfig({ gmailStatus: 'needs_reconnect', gmailStatusReason: 'invalid_grant' }));

        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_RECONNECT_NEEDED' });

        expect(google.requests).toEqual([]);
        expect(notices()).toEqual([noticeOn('2026-11-23')]);
    });
});

describe('every other failure leaves the connection as it is', () => {
    it.each([
        ['a refused message (400)', () => google.sendAnswers.push(gmailError(400, 'invalidArgument')), 'GMAIL_REJECTED'],
        ['a message too large (413)', () => google.sendAnswers.push(gmailError(413, 'uploadTooLarge')), 'GMAIL_REJECTED'],
        ["Gmail's server error (500)", () => google.sendAnswers.push(gmailError(500, 'backendError')), 'GMAIL_UNAVAILABLE'],
        ['no answer from Gmail', () => google.sendAnswers.push('network'), 'GMAIL_UNAVAILABLE'],
        ['no answer from the token endpoint', () => google.refreshAnswers.push('network'), 'GMAIL_UNAVAILABLE'],
        ['another 403', () => google.sendAnswers.push(gmailError(403, 'domainPolicy')), 'GMAIL_FAILED'],
        ['a refused OAuth client', () => google.refreshAnswers.push({ status: 401, body: { error: 'invalid_client' } }), 'GMAIL_FAILED'],
    ])('%s', async (_label, arrange, code) => {
        arrange();

        await expect(send()).rejects.toMatchObject({ code });

        expect(config().gmailStatus).toBe('active');
        expect(notices()).toEqual([]);
    });

    it('an OAuth client missing from Secret Manager: not set up yet', async () => {
        require('../../shared/secretStore').readLatestSecret.mockImplementation(async () => null);

        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_NOT_CONFIGURED', message: 'Sending from Gmail is not set up yet.' });

        expect(google.requests).toEqual([]);
        expect(config().gmailStatus).toBe('active');
    });

    it('a token this function cannot open: not set up, and Google is not asked', async () => {
        mock.docs.set(EMAIL_CONFIG(), gmailConfig({ gmailRefreshToken: 'enc:v1:00:00' }));

        await expect(send()).rejects.toMatchObject({ code: 'GMAIL_NOT_CONFIGURED' });

        expect(google.requests).toEqual([]);
        expect(config().gmailStatus).toBe('active');
    });
});

describe('the logs', () => {
    it('carry the company and the codes, never a token, an address or Google\'s text', async () => {
        await send({ bcc: 'records@example.test' });
        google.sendAnswers.push(gmailError(429, 'rateLimitExceeded'));
        await expect(send()).rejects.toBeDefined();
        google.sendAnswers.push(gmailError(400, 'invalidArgument'));
        await expect(send()).rejects.toBeDefined();
        google.sendAnswers.push('network');
        await expect(send()).rejects.toBeDefined();
        google.sendAnswers.push(gmailError(401, 'authError'));
        google.refreshAnswers.push({ status: 400, body: { error: 'invalid_grant', error_description: `Revoked for ${GMAIL}` } });
        await expect(send()).rejects.toBeDefined();

        const logged = loggedText();
        expect(logged).toContain(COMPANY);
        expect(logged).toContain('rateLimitExceeded');
        expect(logged).toContain('invalid_grant');
        for (const secret of [...SECRETS_AND_ADDRESSES, 'dana.driver', 'records@example.test']) expect(logged).not.toContain(secret);
    });

    it('and an error a caller records carries no Google text either', async () => {
        google.sendAnswers.push(gmailError(400, 'invalidArgument'));
        const error = await send().catch((caught) => caught);
        expect(error.message).toBe('Gmail did not accept this email.');
        expect(JSON.stringify({ ...error, message: error.message })).not.toContain('Artificial Google text');
    });
});

it('asks the token endpoint and Gmail only', async () => {
    await send();
    expect([...new Set(google.requests.map((request) => request.url))]).toEqual([TOKEN_ENDPOINT, SEND_ENDPOINT]);
});
