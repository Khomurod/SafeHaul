/**
 * A company's email settings are read one way, for its own emails and for a
 * bulk campaign alike.
 *
 * The two senders read them apart. A campaign set `secure` from a field no save
 * writes, so a server on port 465 never answered it; it skipped the settings on
 * the company document that the company's own emails still use; and a password
 * it could not decrypt went to the server as the ciphertext. The company's own
 * emails kept a connection for ten minutes by company, so a changed password or
 * server was not used until then, and a replaced connection was never closed.
 *
 * A company that connected Gmail is read as Gmail, and every other company
 * exactly as before.
 *
 * Every address, password and key below is artificial.
 */
process.env.SMS_ENCRYPTION_KEY = '12345678901234567890123456789012';

const mockDocs = new Map();
jest.mock('../../firebaseAdmin', () => {
    const ref = (path) => ({
        get: async () => {
            const data = mockDocs.get(path);
            return { exists: data !== undefined, data: () => data };
        },
        collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
    });
    const db = { collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }) };
    return { db, admin: { firestore: () => db } };
});

const mockTransports = [];
jest.mock('nodemailer', () => ({
    createTransport: (options) => {
        const transport = {
            options,
            sendMail: jest.fn(async () => ({ messageId: 'message-1' })),
            close: jest.fn(),
            transporter: { options },
        };
        mockTransports.push(transport);
        return transport;
    },
}));

const { encrypt } = require('../../integrations/encryption');
const { setupSender } = require('../../bulkActions/workers/senderSetup');
const { sendDynamicEmail } = require('../../emailService');
const { gmailTokenFingerprint, readSmtpSettings, smtpFingerprint } = require('../../shared/smtpSettings');

const COMPANY = 'companies/co-1';
const EMAIL_CONFIG = `${COMPANY}/system_settings/email_config`;
const OLDEST_SETTINGS = `${COMPANY}/integrations/email_settings`;
const SAVED = { smtpHost: 'smtp.example.com', smtpPort: 587, smtpUser: 'hiring@example.com', smtpPass: 'artificial-password' };

/** The connection a campaign would send with, or null. */
async function campaignTransport() {
    const { emailTransporter } = await setupSender({ companyId: 'co-1', sessionRef: null, config: { method: 'email' }, senderId: 'recruiter-1' });
    return emailTransporter ? emailTransporter.options : null;
}

beforeEach(() => {
    mockDocs.clear();
    mockTransports.length = 0;
    mockDocs.set(COMPANY, { companyName: 'Artificial Freight LLC' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('a bulk campaign connects as the company emails do', () => {
    it('opens a TLS connection to a server on port 465', async () => {
        mockDocs.set(EMAIL_CONFIG, { ...SAVED, smtpPort: 465 });
        expect(await campaignTransport()).toMatchObject({ host: 'smtp.example.com', port: 465, secure: true });
    });

    it('starts plain and upgrades on port 587', async () => {
        mockDocs.set(EMAIL_CONFIG, SAVED);
        expect(await campaignTransport()).toMatchObject({
            host: 'smtp.example.com',
            port: 587,
            secure: false,
            auth: { user: 'hiring@example.com', pass: 'artificial-password' },
        });
    });

    it('reads settings kept on the company document, as the company emails do', async () => {
        mockDocs.set(COMPANY, { companyName: 'Artificial Freight LLC', emailSettings: { ...SAVED, smtpPass: `enc:v1:${encrypt('artificial-password')}` } });
        expect(await campaignTransport()).toMatchObject({ host: 'smtp.example.com', auth: { pass: 'artificial-password' } });
    });

    it('does not send a password it cannot decrypt to the server', async () => {
        mockDocs.set(EMAIL_CONFIG, { ...SAVED, smtpPass: 'enc:v1:00:00' });
        expect(await campaignTransport()).toBeNull();
    });

    it('still reads the oldest settings, and a Gmail account without a server', async () => {
        mockDocs.set(OLDEST_SETTINGS, { email: 'hiring@example.com', password: 'artificial-password' });
        expect(await campaignTransport()).toMatchObject({ service: 'gmail', auth: { user: 'hiring@example.com', pass: 'artificial-password' } });
    });
});

describe("the company's own emails", () => {
    // Each case its own company: the connections are kept for the process.
    const send = (companyId) => sendDynamicEmail(companyId, 'driver@example.com', 'Subject', '<p>Body</p>');
    const configOf = (companyId) => `companies/${companyId}/system_settings/email_config`;

    it('use a changed password at once, and close the connection it replaces', async () => {
        mockDocs.set('companies/co-2', { companyName: 'Artificial Freight LLC' });
        mockDocs.set(configOf('co-2'), SAVED);
        await send('co-2');
        mockDocs.set(configOf('co-2'), { ...SAVED, smtpPass: 'artificial-password-2' });
        await send('co-2');

        expect(mockTransports).toHaveLength(2);
        expect(mockTransports[1].options.auth.pass).toBe('artificial-password-2');
        expect(mockTransports[0].close).toHaveBeenCalledTimes(1);
        expect(mockTransports[1].sendMail).toHaveBeenCalledTimes(1);
    });

    it('keep one pooled connection while the settings stay the same', async () => {
        mockDocs.set('companies/co-3', { companyName: 'Artificial Freight LLC' });
        mockDocs.set(configOf('co-3'), SAVED);
        await send('co-3');
        await send('co-3');

        expect(mockTransports).toHaveLength(1);
        expect(mockTransports[0].options).toMatchObject({ pool: true, secure: false });
        expect(mockTransports[0].close).not.toHaveBeenCalled();
        expect(mockTransports[0].sendMail).toHaveBeenCalledTimes(2);
        expect(mockTransports[0].sendMail.mock.calls[0][0].from).toBe('"Artificial Freight LLC" <hiring@example.com>');
    });

    it('open TLS on port 465 when the port was stored as text', async () => {
        mockDocs.set('companies/co-4', { companyName: 'Artificial Freight LLC', emailSettings: { ...SAVED, smtpPort: '465' } });
        await send('co-4');
        expect(mockTransports[0].options).toMatchObject({ port: 465, secure: true });
    });
});

describe('a company that connected Gmail', () => {
    // What `completeGmailConnection` writes next to the SMTP settings it keeps.
    const sealed = () => `enc:v1:${encrypt('artificial-refresh-token')}`;
    const connected = (overrides = {}) => ({
        ...SAVED,
        signature: 'Regards',
        provider: 'gmail',
        gmailEmail: 'dispatch@example.com',
        gmailSub: '1001',
        gmailRefreshToken: sealed(),
        gmailStatus: 'active',
        ...overrides,
    });

    it('is read as Gmail, its token still sealed, and its SMTP settings are not used', async () => {
        const stored = connected();
        mockDocs.set(EMAIL_CONFIG, stored);

        const { settings, companyName } = await readSmtpSettings('co-1');

        expect(companyName).toBe('Artificial Freight LLC');
        expect(settings).toEqual({
            kind: 'gmail',
            user: 'dispatch@example.com',
            sealedRefreshToken: stored.gmailRefreshToken,
            tokenFingerprint: gmailTokenFingerprint(stored.gmailRefreshToken),
            status: 'active',
            signature: 'Regards',
        });
    });

    it('reports a Gmail that needs reconnecting, and reads any other status as active', async () => {
        mockDocs.set(EMAIL_CONFIG, connected({ gmailStatus: 'needs_reconnect' }));
        expect((await readSmtpSettings('co-1')).settings.status).toBe('needs_reconnect');

        mockDocs.set(EMAIL_CONFIG, connected({ gmailStatus: undefined }));
        expect((await readSmtpSettings('co-1')).settings.status).toBe('active');
    });

    it('is not opened by the reader, so a token this function cannot open fails only when Gmail is asked', async () => {
        mockDocs.set(EMAIL_CONFIG, connected({ gmailRefreshToken: 'enc:v1:00:00' }));
        await expect(readSmtpSettings('co-1')).resolves.toMatchObject({ settings: { kind: 'gmail' } });
    });

    it.each([
        ['provider gmail without a token', { gmailRefreshToken: undefined }],
        ['a token without provider gmail', { provider: undefined }],
        ['provider smtp', { provider: 'smtp' }],
    ])('needs both the provider and the token: %s reads the SMTP settings as before', async (_label, overrides) => {
        mockDocs.set(EMAIL_CONFIG, connected(overrides));
        expect((await readSmtpSettings('co-1')).settings).toEqual({
            host: 'smtp.example.com', port: 587, user: 'hiring@example.com', pass: 'artificial-password', signature: 'Regards',
        });
    });

    it('sends a campaign through Gmail, from the Gmail address', async () => {
        mockDocs.set(EMAIL_CONFIG, connected());
        const { emailTransporter, emailFrom } = await setupSender({ companyId: 'co-1', sessionRef: null, config: { method: 'email' }, senderId: 'recruiter-1' });

        expect(emailFrom).toBe('dispatch@example.com');
        expect(emailTransporter.options).toMatchObject({ name: 'SafeHaulGmail', send: expect.any(Function) });
        expect(emailTransporter.options).not.toHaveProperty('auth');
    });
});

describe('a company that never connected Gmail sees no change', () => {
    it('reads exactly the settings it read before, with no new field', async () => {
        mockDocs.set(EMAIL_CONFIG, { ...SAVED, signature: 'Regards' });
        expect((await readSmtpSettings('co-1')).settings).toEqual({
            host: 'smtp.example.com', port: 587, user: 'hiring@example.com', pass: 'artificial-password', signature: 'Regards',
        });
    });

    it('sends a campaign from its SMTP user, over the same connection', async () => {
        mockDocs.set(EMAIL_CONFIG, SAVED);
        const { emailTransporter, emailFrom } = await setupSender({ companyId: 'co-1', sessionRef: null, config: { method: 'email' }, senderId: 'recruiter-1' });

        expect(emailFrom).toBe('hiring@example.com');
        expect(emailTransporter.options).toEqual({
            host: 'smtp.example.com',
            port: 587,
            secure: false,
            auth: { user: 'hiring@example.com', pass: 'artificial-password' },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 30000,
        });
    });

    it('has no sender address for a campaign without settings', async () => {
        await expect(setupSender({ companyId: 'co-1', sessionRef: null, config: { method: 'email' }, senderId: 'recruiter-1' }))
            .resolves.toEqual({ adapter: null, emailTransporter: null, emailFrom: null, failed: null });
    });

    it('keeps the fingerprint its pooled connection is kept by', () => {
        const settings = { host: 'smtp.example.com', port: 587, user: 'hiring@example.com', pass: 'artificial-password', signature: '' };
        const expected = require('crypto').createHash('sha256')
            .update(JSON.stringify(['smtp.example.com', 587, 'hiring@example.com', 'artificial-password'])).digest('hex');
        expect(smtpFingerprint(settings)).toBe(expected);
    });
});
