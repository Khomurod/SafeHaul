/**
 * Before a driver's link is minted and emailed (`emailSenderFor`,
 * `shared/linkDelivery.js`), the company must be able to send: a connected
 * Gmail can, and one that needs reconnecting is refused with its own plain
 * message, so the driver's live link is not retired for an email that cannot
 * go out. SMTP companies are asked exactly as before. The harness is
 * `gmailSending.support.js`; every value is artificial.
 */
jest.mock('../../firebaseAdmin', () => require('./gmailSending.support').firebaseAdminMock());
jest.mock('../../shared/secretStore', () => ({ readLatestSecret: jest.fn() }));

const { emailSenderFor } = require('../../shared/linkDelivery');
const { COMPANY, COMPANY_NAME, EMAIL_CONFIG, gmailConfig, google, mock, resetGmailSending } = require('./gmailSending.support');

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
