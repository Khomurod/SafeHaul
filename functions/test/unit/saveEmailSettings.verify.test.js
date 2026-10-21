/**
 * Saving a company's email settings marks them verified only when the server
 * connected with them.
 *
 * `saveEmailSettings` stored `isVerified: true` on every save. The settings
 * screen calls it after a passing Test Connection, and also from Save Settings
 * with no test at all, so a mistyped server or a stale password still read
 * "Successfully Linked". Every address and password below is artificial.
 */
jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_options, handler) => handler,
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));

const mockDocs = new Map();
const mockWrites = [];
jest.mock('../../firebaseAdmin', () => {
    const ref = (path) => ({
        get: async () => {
            const data = mockDocs.get(path);
            return { exists: data !== undefined, data: () => data };
        },
        set: async (data) => { mockWrites.push({ path, data }); },
        update: async (data) => { mockWrites.push({ path, data }); },
        collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
    });
    const db = { collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }) };
    return { db, admin: { firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => 'server-time', delete: () => 'field-delete' } }) } };
});
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: async () => true }));
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAdminStrict: async () => {} }));

const mockVerify = jest.fn();
const mockTransportOptions = [];
jest.mock('nodemailer', () => ({
    createTransport: (options) => {
        mockTransportOptions.push(options);
        return { verify: mockVerify };
    },
}));

const { saveEmailSettings } = require('../../saveEmailSettings');
const { decrypt, encrypt } = require('../../integrations/encryption');

/** The password a stored `enc:v1:` value holds. */
const opened = (stored) => {
    expect(stored).toMatch(/^enc:v1:/);
    return decrypt(stored.slice('enc:v1:'.length));
};

const EMAIL_CONFIG = 'companies/co-1/system_settings/email_config';
const FORM = { companyId: 'co-1', smtpHost: 'smtp.example.com', smtpPort: 587, smtpUser: 'hiring@example.com', signature: '' };
const save = (data) => saveEmailSettings({ auth: { uid: 'admin-1' }, data });
const storedConfig = () => mockWrites.find((write) => write.path === EMAIL_CONFIG).data;

beforeEach(() => {
    jest.resetAllMocks();
    process.env.SMS_ENCRYPTION_KEY = 'artificial-key-of-32-characters!';
    mockDocs.clear();
    mockWrites.length = 0;
    mockTransportOptions.length = 0;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('saveEmailSettings verifies what it saves', () => {
    it('marks the settings verified when the server connects with them', async () => {
        mockVerify.mockResolvedValue(true);
        const result = await save({ ...FORM, smtpPass: 'artificial-password' });

        expect(mockTransportOptions[0]).toMatchObject({
            host: 'smtp.example.com',
            port: 587,
            auth: { user: 'hiring@example.com', pass: 'artificial-password' },
            // The save waits on the check, so no stage of it may outlast the function.
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 20000,
        });
        expect(storedConfig().isVerified).toBe(true);
        expect(result).toMatchObject({ success: true, verified: true });
        expect(JSON.stringify(result)).not.toContain('artificial-password');
    });

    it('saves settings that do not connect as unverified, and says why', async () => {
        mockVerify.mockRejectedValue(Object.assign(new Error('Invalid login'), { code: 'EAUTH' }));
        const result = await save({ ...FORM, smtpPass: 'artificial-password' });

        expect(storedConfig()).toMatchObject({ smtpHost: 'smtp.example.com', isVerified: false });
        expect(result).toMatchObject({ success: true, verified: false });
        expect(result.verificationError).toMatch(/authentication failed/i);
    });

    it('checks the stored password when the form leaves it blank', async () => {
        mockDocs.set(EMAIL_CONFIG, { smtpPass: 'stored-password' });
        mockVerify.mockResolvedValue(true);
        const result = await save(FORM);

        expect(mockTransportOptions[0].auth.pass).toBe('stored-password');
        // A password stored before encryption is encrypted on the next save.
        expect(opened(storedConfig().smtpPass)).toBe('stored-password');
        expect(storedConfig().isVerified).toBe(true);
        expect(result.verified).toBe(true);
    });

    it('keeps a stored encrypted password as it is, and connects with what it holds', async () => {
        const stored = `enc:v1:${encrypt('stored-password')}`;
        mockDocs.set(EMAIL_CONFIG, { smtpPass: stored });
        mockVerify.mockResolvedValue(true);
        await save(FORM);

        expect(mockTransportOptions[0].auth.pass).toBe('stored-password');
        expect(storedConfig().smtpPass).toBe(stored);
    });
});

describe('what saveEmailSettings stores', () => {
    it('stores a new password over the stored one, trimmed and otherwise as typed', async () => {
        mockDocs.set(EMAIL_CONFIG, { smtpPass: 'stored-password' });
        mockVerify.mockResolvedValue(true);
        await save({ ...FORM, smtpPass: '  p@ss w0rd!#$%^&*()  ' });

        expect(mockTransportOptions[0].auth.pass).toBe('p@ss w0rd!#$%^&*()');
        expect(JSON.stringify(storedConfig())).not.toContain('p@ss w0rd');
        expect(opened(storedConfig().smtpPass)).toBe('p@ss w0rd!#$%^&*()');
    });

    it('refuses a value that is already encrypted, and writes nothing', async () => {
        await expect(save({ ...FORM, smtpPass: `enc:v1:${encrypt('x')}` })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockWrites).toEqual([]);
        expect(mockVerify).not.toHaveBeenCalled();
    });

    it('refuses a first setup without a password, and writes nothing', async () => {
        await expect(save({ ...FORM, smtpPass: '   ' })).rejects.toMatchObject({
            code: 'invalid-argument',
            message: 'SMTP password is required for initial setup. Please enter your SMTP password.',
        });
        expect(mockWrites).toEqual([]);
        expect(mockVerify).not.toHaveBeenCalled();
    });

    it("copies the settings to the company document for its status, never the password", async () => {
        mockVerify.mockResolvedValue(true);
        await save({ ...FORM, smtpPass: 'artificial-password', signature: 'Best regards' });

        const companyWrite = mockWrites.find((write) => write.path === 'companies/co-1');
        expect(companyWrite.data).toEqual({
            'emailSettings.smtpHost': 'smtp.example.com',
            'emailSettings.smtpPort': 587,
            'emailSettings.smtpUser': 'hiring@example.com',
            'emailSettings.signature': 'Best regards',
            'emailSettings.isVerified': true,
            'emailSettings.updatedAt': 'server-time',
            // The copy older saves left on the company document, which the whole team reads.
            'emailSettings.smtpPass': 'field-delete',
        });
        expect(JSON.stringify(companyWrite.data)).not.toContain('artificial-password');
    });
});
