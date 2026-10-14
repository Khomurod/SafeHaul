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
    return { db, admin: { firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => 'server-time' } }) } };
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

const EMAIL_CONFIG = 'companies/co-1/system_settings/email_config';
const FORM = { companyId: 'co-1', smtpHost: 'smtp.example.com', smtpPort: 587, smtpUser: 'hiring@example.com', signature: '' };
const save = (data) => saveEmailSettings({ auth: { uid: 'admin-1' }, data });
const storedConfig = () => mockWrites.find((write) => write.path === EMAIL_CONFIG).data;

beforeEach(() => {
    jest.resetAllMocks();
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
        expect(storedConfig()).toMatchObject({ smtpPass: 'stored-password', isVerified: true });
        expect(result.verified).toBe(true);
    });
});
