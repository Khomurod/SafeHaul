/**
 * emailService — Unit Tests
 *
 * Where a company's SMTP settings are read from, and how a stored password is
 * read, through the real reader (`shared/smtpSettings.js`) that the company's
 * emails and bulk campaigns share. These cases tested a copy of the old
 * reader's logic; they now run the code itself. Every value is artificial.
 */
const VALID_KEY = '12345678901234567890123456789012'; // 32 chars for AES-256
process.env.SMS_ENCRYPTION_KEY = VALID_KEY;

const mockDocs = new Map();
jest.mock('../../firebaseAdmin', () => {
    const ref = (path) => ({
        get: async () => {
            const data = mockDocs.get(path);
            return { exists: data !== undefined, data: () => data };
        },
        collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
    });
    return { db: { collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }) } };
});

const enc = require('../../integrations/encryption');
const { normalizeSmtpSettings, readSmtpSettings } = require('../../shared/smtpSettings');

const EMAIL_CONFIG = 'companies/co-1/system_settings/email_config';

beforeEach(() => {
    mockDocs.clear();
    enc._resetEncryptionKeyForTesting();
});

describe('emailService — where the settings are read from', () => {
    it('should prefer subcollection data when it has smtpPass', async () => {
        mockDocs.set('companies/co-1', { emailSettings: { smtpHost: 'smtp.old.example.com', smtpPass: 'old-plaintext' } });
        mockDocs.set(EMAIL_CONFIG, { smtpHost: 'smtp.example.com', smtpUser: 'hiring@example.com', smtpPass: 'new-plaintext' });

        const { settings } = await readSmtpSettings('co-1');
        expect(settings).toMatchObject({ host: 'smtp.example.com', pass: 'new-plaintext' });
    });

    it('should fallback to root when subcollection is empty', async () => {
        mockDocs.set('companies/co-1', { emailSettings: { smtpHost: 'smtp.example.com', smtpPass: `enc:v1:${enc.encrypt('legacy-pass')}` } });

        const { settings } = await readSmtpSettings('co-1');
        expect(settings).toMatchObject({ host: 'smtp.example.com', pass: 'legacy-pass' });
    });

    it('should fallback to root when subcollection exists but no smtpPass', async () => {
        mockDocs.set('companies/co-1', { emailSettings: { smtpHost: 'smtp.example.com', smtpPass: 'legacy-pass' } });
        mockDocs.set(EMAIL_CONFIG, { smtpHost: 'smtp.example.com' });

        const { settings } = await readSmtpSettings('co-1');
        expect(settings.pass).toBe('legacy-pass');
    });

    it('should return null when neither source has settings', async () => {
        mockDocs.set('companies/co-1', { companyName: 'Artificial Freight LLC' });

        expect(await readSmtpSettings('co-1')).toEqual({ settings: null, companyName: 'Artificial Freight LLC' });
    });
});

describe('emailService — stored password compatibility', () => {
    it('should decrypt enc:v1: prefixed passwords (legacy support)', () => {
        const storedValue = `enc:v1:${enc.encrypt('my-smtp-password')}`;
        expect(normalizeSmtpSettings({ smtpPass: storedValue }).pass).toBe('my-smtp-password');
    });

    it('should pass plaintext passwords through unchanged', () => {
        const plaintextValues = [
            'my-app-password',
            'SG.abc123def456',
            'xxxx xxxx xxxx xxxx',
        ];

        plaintextValues.forEach((value) => {
            expect(normalizeSmtpSettings({ smtpPass: value }).pass).toBe(value);
        });
    });

    it('should treat empty/null passwords as no settings', () => {
        [null, undefined, ''].forEach((value) => {
            expect(normalizeSmtpSettings({ smtpHost: 'smtp.example.com', smtpPass: value })).toBeNull();
        });
    });
});
