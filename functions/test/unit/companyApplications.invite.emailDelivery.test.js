/**
 * "Email to driver": the server emails the driver's link to the draft's own
 * address, so the carrier never holds it.
 *
 * Pinned here:
 *  - the caller is told the masked address and never the token or the link;
 *  - the link opens what a copied one opens, under the same rules (a hash
 *    stored, an expiry, one live link, the identity check on the driver's
 *    answers);
 *  - nothing is minted, so the driver's live link stays live, when there is no
 *    address to use, no company email, a limit reached, or an email sent a
 *    moment ago;
 *  - one press is one email, and a failed send says nobody received it;
 *  - nothing logs the token or the link.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/https', () => require('./applicationDrafts.support').httpsV2Mock());
jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());
jest.mock('../../shared/companyAccess', () => require('./applicationDrafts.support').companyAccessMock());
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./applicationDrafts.support').rateLimiterMock());
jest.mock('../../shared/companyTenant', () => require('./applicationDrafts.support').companyTenantMock());

const mockSendEmail = jest.fn();
const mockReadSmtp = jest.fn();
jest.mock('../../emailService', () => ({ sendDynamicEmail: (...args) => mockSendEmail(...args) }));
jest.mock('../../shared/smtpSettings', () => ({ readSmtpSettings: (...args) => mockReadSmtp(...args) }));

const crypto = require('crypto');
const {
    mockStore, mockCheckRateLimit, mockAssertIntake,
    COMPANY, CONTEXT, IDENTITY, keyFor, saveFirstPage, resetDraftState,
} = require('./applicationDrafts.support');

const REQUEST = { auth: { uid: 'recruiter-1', token: { name: 'Rae Recruiter' } } };
const PATH = (key = keyFor()) => `companies/${COMPANY}/application_drafts/${key}`;
const TESTING = 'https://truckerapp-system.web.app';

const api = () => require('../../companyApplications');

function prepare(overrides = {}) {
    return api().saveCompanyPreparedApplication({
        ...REQUEST,
        data: {
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: { firstName: 'Dana', lastName: 'Alvarez' },
            ...overrides,
        },
    });
}

function emailIt(applicantKey = keyFor(), extra = {}) {
    return api().mintApplicationInvite({
        ...REQUEST,
        data: { companyId: COMPANY, applicantKey, deliver: 'email', appBaseUrl: TESTING, ...extra },
    });
}

function exchange(inviteToken, applicantKey = keyFor()) {
    return api().exchangeApplicationInvite({ companyId: COMPANY, applicantKey, inviteToken }, CONTEXT);
}

/** The token in the one email sent, read from its link. */
function emailedToken(call = 0) {
    const html = mockSendEmail.mock.calls[call][3];
    return html.match(/invite=([0-9a-f]{64})/)[1];
}

const hashOf = (token) => crypto.createHash('sha256').update(token).digest('hex');

let logs;
beforeEach(() => {
    resetDraftState();
    mockSendEmail.mockResolvedValue({ success: true });
    mockReadSmtp.mockResolvedValue({ settings: { user: 'hr@acme.test' }, companyName: 'Acme Freight' });
    logs = [];
    for (const level of ['log', 'info', 'warn', 'error']) {
        jest.spyOn(console, level).mockImplementation((...args) => logs.push(args.map(String).join(' ')));
    }
});
afterEach(() => jest.restoreAllMocks());

describe('emailing a prepared application’s link', () => {
    it('sends it to the draft’s own address and tells the caller only where, masked', async () => {
        await prepare();
        const result = await emailIt();

        expect(result).toEqual({
            delivered: { channel: 'email', to: 'd***@example.test' },
            applicantKey: keyFor(),
            expiresInDays: 14,
            requiresIdentity: false,
        });
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        const [companyId, to, subject, html] = mockSendEmail.mock.calls[0];
        expect(companyId).toBe(COMPANY);
        expect(to).toBe(IDENTITY.email);
        expect(subject).toContain('Acme Freight');
        expect(html).toContain(`${TESTING}/apply/${COMPANY}?invite=`);
        expect(html).toContain(`&amp;k=${keyFor()}`);
        expect(html).toContain('Dana');

        const token = emailedToken();
        expect(JSON.stringify(result)).not.toContain(token);
        // The same token model as a copied link: only the hash is stored.
        const stored = mockStore.get(PATH());
        expect(stored.inviteTokenHash).toBe(hashOf(token));
        expect(JSON.stringify(stored)).not.toContain(token);
        expect(stored.status).toBe('sent');
        expect(stored.inviteDelivery).toMatchObject({
            channel: 'email', status: 'sent', to: 'd***@example.test', by: 'recruiter-1',
        });
    });

    it('opens for the driver exactly as a copied link does', async () => {
        await prepare();
        await emailIt();

        await expect(exchange(emailedToken())).resolves.toMatchObject({
            opened: true, requiresIdentity: false, formData: { firstName: 'Dana' },
        });
    });

    it('uses the company’s apply slug, and never a site the caller names', async () => {
        mockAssertIntake.mockResolvedValue({ companyName: 'Acme Freight', appSlug: 'acme' });
        await prepare();
        await emailIt(keyFor(), { appBaseUrl: 'https://evil.example' });

        expect(mockSendEmail.mock.calls[0][3]).toContain('https://app.safehaul.io/apply/acme?invite=');
        expect(mockSendEmail.mock.calls[0][3]).not.toContain('evil.example');
    });

    it('retires the link it replaces, as every new link does', async () => {
        await prepare();
        const copied = await api().mintApplicationInvite({ ...REQUEST, data: { companyId: COMPANY, applicantKey: keyFor() } });
        await emailIt();

        const stored = mockStore.get(PATH());
        expect(stored.inviteTokenHash).toBe(hashOf(emailedToken()));
        expect(stored.priorInvites).toHaveLength(1);
        expect(stored.priorInvites[0].hash).toBe(hashOf(copied.inviteToken));
    });
});

describe('a driver who started the application themselves', () => {
    it('gets a continuation link that still asks who they are', async () => {
        await saveFirstPage();
        const result = await emailIt();

        expect(result.requiresIdentity).toBe(true);
        expect(mockSendEmail.mock.calls[0][3]).toMatch(/confirm/i);
        // The status a driver-started draft has is left alone.
        expect(mockStore.get(PATH()).status).not.toBe('sent');
        await expect(exchange(emailedToken())).resolves.toEqual({
            opened: true, requiresIdentity: true, applicantKey: keyFor(),
        });
    });
});

describe('nothing is minted when it cannot be emailed', () => {
    it.each([
        ['no email at all', { email: '' }],
        ['a placeholder address', { email: 'dana@placeholder.safehaulapp.com' }],
    ])('refuses %s, and says why', async (_label, contact) => {
        await prepare(contact);
        const key = keyFor(COMPANY, contact.email, IDENTITY.phone);

        await expect(emailIt(key)).rejects.toMatchObject({
            code: 'failed-precondition', details: { reason: 'no-email' },
        });
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockStore.get(PATH(key)).inviteTokenHash).toBeUndefined();
        expect(mockStore.get(PATH(key)).status).toBe('prepared');
    });

    it('refuses when the company has no email set up, before minting', async () => {
        mockReadSmtp.mockResolvedValue({ settings: null, companyName: 'Acme Freight' });
        await prepare();

        await expect(emailIt()).rejects.toMatchObject({
            code: 'failed-precondition', details: { reason: 'email-not-configured' },
        });
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockStore.get(PATH()).inviteTokenHash).toBeUndefined();
    });

    it('keeps the link the driver has when an email went out a moment ago', async () => {
        await prepare();
        await emailIt();
        const live = mockStore.get(PATH()).inviteTokenHash;

        await expect(emailIt()).rejects.toMatchObject({
            code: 'failed-precondition', details: { reason: 'just-sent' },
        });
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockStore.get(PATH()).inviteTokenHash).toBe(live);
    });

    it('limits emails per recruiter and per application', async () => {
        await prepare();
        mockCheckRateLimit.mockImplementation(async (key) => !key.startsWith('link_email_'));

        await expect(emailIt()).rejects.toMatchObject({
            code: 'resource-exhausted', details: { reason: 'rate-limited' },
        });
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockStore.get(PATH()).inviteTokenHash).toBeUndefined();

        mockCheckRateLimit.mockResolvedValue(true);
        await emailIt();
        const keys = mockCheckRateLimit.mock.calls.map(([key]) => key);
        expect(keys).toContain(`link_email_${COMPANY}_recruiter-1`);
        expect(keys).toContain(`link_email_invite_${COMPANY}_${keyFor()}`);
    });

    it('refuses a channel it does not offer', async () => {
        await prepare();
        await expect(emailIt(keyFor(), { deliver: 'sms' })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockStore.get(PATH()).inviteTokenHash).toBeUndefined();
    });
});

describe('a send that fails', () => {
    it('says nobody received it, and lets the recruiter try again at once', async () => {
        await prepare();
        mockSendEmail.mockRejectedValueOnce(new Error('Failed to send email: 535 auth failed'));

        await expect(emailIt()).rejects.toMatchObject({
            code: 'unavailable', details: { reason: 'email-failed' },
        });
        expect(mockStore.get(PATH()).inviteDelivery.status).toBe('failed');

        await expect(emailIt()).resolves.toMatchObject({ delivered: { to: 'd***@example.test' } });
        expect(mockSendEmail).toHaveBeenCalledTimes(2);
    });
});

describe('the logs', () => {
    it('never hold the token or the link, sent or failed', async () => {
        await prepare();
        await emailIt();
        const sent = emailedToken(0);

        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000);
        mockSendEmail.mockRejectedValueOnce(new Error('Failed to send email: rejected'));
        await expect(emailIt()).rejects.toMatchObject({ code: 'unavailable' });
        const failed = emailedToken(1);

        const all = logs.join('\n');
        expect(all).not.toContain(sent);
        expect(all).not.toContain(failed);
        expect(all).not.toContain('invite=');
    });
});
