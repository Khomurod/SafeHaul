/**
 * `saveEmailSettings` while Gmail is connected: `signatureOnly` saves the
 * signature alone (and only then), with no SMTP fields and no connection check, and a full SMTP
 * save is refused so the mail-server settings kept for a disconnect are not
 * replaced by mistake. Every address and password below is artificial.
 */
jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_options, handler) => handler,
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mockStore = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({ admin: mockStore.admin, db: mockStore.db }));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn() }));
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAdminStrict: jest.fn() }));
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const nodemailer = require('nodemailer');
const { saveEmailSettings } = require('../../saveEmailSettings');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAdminStrict } = require('../../shared/companyAccess');

const EMAIL_CONFIG = 'companies/co-1/system_settings/email_config';
const SMTP = { smtpHost: 'smtp.example.test', smtpPort: 587, smtpUser: 'ops@example.test', smtpPass: 'enc:v1:kept', signature: 'Old', isVerified: true };
const GMAIL = { provider: 'gmail', gmailEmail: 'hiring@example.test', gmailRefreshToken: 'enc:v1:sealed' };
const FORM = { companyId: 'co-1', smtpHost: 'smtp.other.test', smtpPort: 587, smtpUser: 'new@example.test', smtpPass: 'artificial-password', signature: '' };

const save = (data, uid = 'admin-1') => saveEmailSettings({ auth: { uid }, data });

beforeEach(() => {
    jest.resetAllMocks();
    process.env.SMS_ENCRYPTION_KEY = 'artificial-key-of-32-characters!';
    checkRateLimit.mockImplementation(async () => true);
    assertCompanyAdminStrict.mockImplementation(async () => undefined);
    nodemailer.createTransport.mockImplementation(() => ({ verify: async () => true }));
    mockStore.reset({
        'companies/co-1': { companyName: 'Artificial Carrier', emailSettings: { smtpHost: 'smtp.example.test', signature: 'Old' } },
        [EMAIL_CONFIG]: { ...SMTP, ...GMAIL },
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('saveEmailSettings with signatureOnly', () => {
    it('saves the signature alone, with no SMTP fields and no connection check', async () => {
        const result = await save({ companyId: 'co-1', signatureOnly: true, signature: 'Best regards,\nHiring' });

        expect(result).toEqual({ success: true, message: 'Signature saved.' });
        expect(mockStore.docs.get(EMAIL_CONFIG)).toEqual({
            ...SMTP,
            ...GMAIL,
            signature: 'Best regards,\nHiring',
            updatedAt: '__server_timestamp__',
            updatedBy: 'admin-1',
        });
        expect(mockStore.docs.get('companies/co-1').emailSettings).toEqual({ smtpHost: 'smtp.example.test', signature: 'Best regards,\nHiring' });
        expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('also changes the signature on the oldest settings, which the mail server sends with after a disconnect', async () => {
        const OLDEST = 'companies/co-1/integrations/email_settings';
        const oldest = { email: 'ops@example.test', password: 'artificial-plain-password', signature: 'Old' };
        mockStore.docs.set(OLDEST, oldest);

        await save({ companyId: 'co-1', signatureOnly: true, signature: 'New' });
        expect(mockStore.docs.get(OLDEST)).toEqual({ ...oldest, signature: 'New' });

        // Gmail disconnected: the mail server reads the oldest settings, with the new signature.
        const { readSmtpSettings } = require('../../shared/smtpSettings');
        mockStore.docs.set(EMAIL_CONFIG, { signature: 'New', gmailDisconnectedAt: 'then' });
        mockStore.docs.set('companies/co-1', { companyName: 'Artificial Carrier', emailSettings: { signature: 'New' } });
        await expect(readSmtpSettings('co-1')).resolves.toMatchObject({ settings: { user: 'ops@example.test', signature: 'New' } });
    });

    it('creates no oldest settings where there are none', async () => {
        await save({ companyId: 'co-1', signatureOnly: true, signature: 'New' });
        expect(mockStore.docs.has('companies/co-1/integrations/email_settings')).toBe(false);
    });

    it('ignores SMTP fields sent along with it', async () => {
        await save({ ...FORM, signatureOnly: true, signature: 'Hi' });
        expect(mockStore.docs.get(EMAIL_CONFIG)).toMatchObject({ smtpHost: 'smtp.example.test', smtpUser: 'ops@example.test', smtpPass: 'enc:v1:kept', signature: 'Hi' });
    });

    it('saves an empty signature as empty text', async () => {
        await save({ companyId: 'co-1', signatureOnly: true });
        expect(mockStore.docs.get(EMAIL_CONFIG).signature).toBe('');
    });

    it('stays admin-only and rate-limited, and needs the company', async () => {
        await expect(save({ signatureOnly: true, signature: 'x' })).rejects.toMatchObject({ code: 'invalid-argument', message: 'Missing required field: companyId.' });
        await expect(save({ companyId: 'co-1', signatureOnly: true, signature: { html: 'x' } })).rejects.toMatchObject({ code: 'invalid-argument' });

        checkRateLimit.mockImplementation(async () => false);
        await expect(save({ companyId: 'co-1', signatureOnly: true, signature: 'x' })).rejects.toMatchObject({ code: 'resource-exhausted' });

        checkRateLimit.mockImplementation(async () => true);
        assertCompanyAdminStrict.mockImplementation(async () => {
            throw Object.assign(new Error('Company admin access required.'), { code: 'permission-denied' });
        });
        await expect(save({ companyId: 'co-1', signatureOnly: true, signature: 'x' })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockStore.docs.get(EMAIL_CONFIG).signature).toBe('Old');
    });

    it('is refused while the company sends through its mail server, and writes nothing', async () => {
        const message = 'Save the signature together with your mail server settings.';
        mockStore.docs.set(EMAIL_CONFIG, { ...SMTP });
        await expect(save({ companyId: 'co-1', signatureOnly: true, signature: 'x' })).rejects.toMatchObject({ code: 'failed-precondition', message });
        expect(mockStore.docs.get(EMAIL_CONFIG)).toEqual(SMTP);

        // Older settings kept only on the company document: no email_config is created to hide them.
        mockStore.docs.delete(EMAIL_CONFIG);
        await expect(save({ companyId: 'co-1', signatureOnly: true, signature: 'x' })).rejects.toMatchObject({ code: 'failed-precondition', message });
        expect(mockStore.docs.has(EMAIL_CONFIG)).toBe(false);
        expect(mockStore.docs.get('companies/co-1').emailSettings.signature).toBe('Old');
    });

    it('takes only true: anything else is a full SMTP save', async () => {
        await expect(save({ companyId: 'co-1', signatureOnly: 'true', signature: 'x' }))
            .rejects.toMatchObject({ code: 'invalid-argument', message: 'Missing required fields: companyId, smtpHost, smtpUser.' });
    });
});

describe('a full SMTP save while Gmail is connected', () => {
    it('is refused, and changes nothing', async () => {
        await expect(save(FORM)).rejects.toMatchObject({
            code: 'failed-precondition',
            message: 'Gmail is connected. Disconnect Gmail in Settings → Email to send through your mail server again.',
        });
        expect(mockStore.docs.get(EMAIL_CONFIG)).toEqual({ ...SMTP, ...GMAIL });
        expect(mockStore.docs.get('companies/co-1').emailSettings.smtpHost).toBe('smtp.example.test');
        expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('goes through again once Gmail is disconnected', async () => {
        mockStore.docs.set(EMAIL_CONFIG, { ...SMTP, gmailDisconnectedAt: 'then' });
        await expect(save(FORM)).resolves.toMatchObject({ success: true, verified: true });
        expect(mockStore.docs.get(EMAIL_CONFIG)).toMatchObject({ smtpHost: 'smtp.other.test', smtpUser: 'new@example.test' });
    });
});
