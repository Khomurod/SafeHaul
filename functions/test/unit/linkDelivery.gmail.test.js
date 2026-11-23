/**
 * Before a driver's link is minted and emailed (`emailSenderFor`,
 * `shared/linkDelivery.js`), the company must be able to send: a connected
 * Gmail can, and one that needs reconnecting is refused with its own plain
 * message, so the driver's live link is not retired for an email that cannot
 * go out. SMTP companies are asked exactly as before. When the email itself
 * fails (`sendClaimedEmail`), a Gmail failure says Gmail's plain message under
 * the same `email-failed` reason the screens know. The harness is
 * `gmailSending.support.js`; every value is artificial.
 */
jest.mock('../../firebaseAdmin', () => require('./gmailSending.support').firebaseAdminMock());
jest.mock('../../shared/secretStore', () => ({ readLatestSecret: jest.fn() }));

const nodemailer = require('nodemailer');
const { emailSenderFor, sendClaimedEmail } = require('../../shared/linkDelivery');
const {
    COMPANY, COMPANY_NAME, EMAIL_CONFIG, SECRETS_AND_ADDRESSES, gmailConfig, gmailError, google, loggedText, mock,
    resetGmailSending,
} = require('./gmailSending.support');

const DRIVER = 'dana.driver@example.test';
const RECORD = (companyId) => `companies/${companyId}/applications/app-1`;

/** One claimed link email for the company's driver, and the refusal if it failed. */
async function sendLink(companyId = COMPANY) {
    const claim = { claimId: 'claim-1', status: 'sending', to: 'd***@example.test' };
    mock.docs.set(RECORD(companyId), { linkEmail: claim });
    const ref = mock.db.collection('companies').doc(companyId).collection('applications').doc('app-1');
    return sendClaimedEmail({
        companyId, ref, field: 'linkEmail', claim, to: DRIVER, subject: 'Your link', html: '<p>Hello</p>', label: 'test',
    }).catch((caught) => caught);
}

beforeEach(() => {
    resetGmailSending();
});

afterEach(() => {
    jest.restoreAllMocks();
});

it('sends for a company whose Gmail is connected, without asking Google', async () => {
    await expect(emailSenderFor(COMPANY)).resolves.toEqual({ companyName: COMPANY_NAME });
    expect(google.requests).toEqual([]);
});

it('refuses, before anything is minted, while Gmail needs reconnecting', async () => {
    mock.docs.set(EMAIL_CONFIG(), gmailConfig({ gmailStatus: 'needs_reconnect', gmailStatusReason: 'invalid_grant' }));

    const refused = await emailSenderFor(COMPANY).catch((caught) => caught);

    expect(refused).toMatchObject({
        code: 'failed-precondition',
        details: { reason: 'gmail-reconnect' },
        message: 'Nothing was sent. Gmail needs reconnecting: a company admin can reconnect it in Settings → Email. Until then, copy the link.',
    });
});

it('sends for an SMTP company as before', async () => {
    mock.docs.set(EMAIL_CONFIG(), { smtpHost: 'smtp.example.test', smtpUser: 'ops@example.test', smtpPass: 'artificial-password' });
    await expect(emailSenderFor(COMPANY)).resolves.toEqual({ companyName: COMPANY_NAME });
});

it('has no sender for a company without email settings', async () => {
    mock.docs.delete(EMAIL_CONFIG());
    await expect(emailSenderFor(COMPANY)).resolves.toBeNull();
});

describe('when the email itself fails', () => {
    it("says Gmail's plain message, under the reason the screens know", async () => {
        google.sendAnswers.push(gmailError(429, 'rateLimitExceeded'));

        const refused = await sendLink();

        expect(refused).toMatchObject({
            code: 'unavailable',
            details: { reason: 'email-failed' },
            message: "The email could not be sent. Gmail's sending limit was reached; try again later. Nobody received "
                + 'the new link. Try again, or copy a link instead.',
        });
        expect(mock.docs.get(RECORD(COMPANY)).linkEmail).toMatchObject({ status: 'failed' });
        for (const secret of [...SECRETS_AND_ADDRESSES, DRIVER]) expect(loggedText()).not.toContain(secret);
    });

    it("keeps the mail server's fixed message for an SMTP company, never the server's own text", async () => {
        // A company of its own: SMTP connections are kept per company for the process.
        mock.docs.set('companies/co-smtp', { companyName: COMPANY_NAME });
        mock.docs.set(EMAIL_CONFIG('co-smtp'), { smtpHost: 'smtp.example.test', smtpUser: 'ops@example.test', smtpPass: 'artificial-password' });
        const refusedByServer = Object.assign(new Error(`Invalid login: 535 for ${DRIVER}`), { code: 'EAUTH' });
        jest.spyOn(nodemailer, 'createTransport').mockImplementation((options) => ({
            options, sendMail: async () => { throw refusedByServer; }, close() {},
        }));

        const refused = await sendLink('co-smtp');

        expect(refused).toMatchObject({
            code: 'unavailable',
            details: { reason: 'email-failed' },
            message: "The email could not be sent: your company's email server did not accept it. Nobody received "
                + 'the new link. Try again, or copy a link instead.',
        });
        expect(loggedText()).not.toContain('535');
    });
});
