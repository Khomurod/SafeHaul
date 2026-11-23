/**
 * `getEmailSettingsMeta` tells the Email tab whether Gmail is connected, as
 * who, since when and by whom — never the token. The settings the current
 * screen reads keep their shape. Every value below is artificial.
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
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAdminStrict: jest.fn() }));

const { getEmailSettingsMeta } = require('../../getEmailSettingsMeta');
const { assertCompanyAdminStrict } = require('../../shared/companyAccess');

const EMAIL_CONFIG = 'companies/co-1/system_settings/email_config';
const SMTP = { smtpHost: 'smtp.example.test', smtpPort: 465, smtpUser: 'ops@example.test', smtpPass: 'enc:v1:x', signature: 'Regards', isVerified: true };
const NOT_CONNECTED = { connected: false, email: null, status: null, statusReason: null, connectedAt: null, connectedByName: null };
const CONNECTED_AT = Date.parse('2026-11-20T15:30:00Z');

const meta = async () => (await getEmailSettingsMeta({ auth: { uid: 'admin-1' }, data: { companyId: 'co-1' } })).settings;

function gmailConnected(overrides = {}) {
    mockStore.docs.set(EMAIL_CONFIG, {
        ...SMTP,
        provider: 'gmail',
        gmailEmail: 'hiring@example.test',
        gmailSub: '1001',
        gmailRefreshToken: 'enc:v1:artificial-sealed-token',
        gmailConnectedAt: { toMillis: () => CONNECTED_AT },
        gmailConnectedBy: 'admin-0',
        gmailStatus: 'active',
        gmailStatusReason: null,
        ...overrides,
    });
}

beforeEach(() => {
    jest.resetAllMocks();
    assertCompanyAdminStrict.mockImplementation(async () => undefined);
    mockStore.reset({ 'companies/co-1': { companyName: 'Artificial Carrier' } });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('getEmailSettingsMeta: Gmail', () => {
    it('says Gmail is connected, as whom, since when and by whom, and never returns the token', async () => {
        gmailConnected();
        mockStore.docs.set('users/admin-0', { name: 'Anna Lee', email: 'anna@example.test' });

        const settings = await meta();

        expect(settings.gmail).toEqual({
            connected: true,
            email: 'hiring@example.test',
            status: 'active',
            statusReason: null,
            connectedAt: CONNECTED_AT,
            connectedByName: 'Anna Lee',
        });
        // What the current screen reads is unchanged.
        expect(settings).toMatchObject({ smtpHost: 'smtp.example.test', smtpPort: 465, smtpUser: 'ops@example.test', signature: 'Regards', isVerified: true, hasPassword: true });
        expect(JSON.stringify(settings)).not.toMatch(/artificial-sealed-token|gmailRefreshToken|1001|smtpPass/);
    });

    it('passes a connection that needs reconnecting through, with its reason', async () => {
        gmailConnected({ gmailStatus: 'needs_reconnect', gmailStatusReason: 'invalid_grant' });
        expect((await meta()).gmail).toMatchObject({ connected: true, status: 'needs_reconnect', statusReason: 'invalid_grant' });
    });

    it('leaves the name out when the user who connected is gone or cannot be read', async () => {
        gmailConnected();
        expect((await meta()).gmail.connectedByName).toBeNull();

        const users = mockStore.db.collection;
        jest.spyOn(mockStore.db, 'collection').mockImplementation((name) => {
            if (name === 'users') throw Object.assign(new Error('unavailable'), { code: 14 });
            return users(name);
        });
        expect((await meta()).gmail).toMatchObject({ connected: true, connectedByName: null });
    });

    it('says not connected without a stored token, or after a disconnect', async () => {
        gmailConnected({ gmailRefreshToken: undefined });
        expect((await meta()).gmail).toEqual(NOT_CONNECTED);

        mockStore.docs.set(EMAIL_CONFIG, { ...SMTP, gmailDisconnectedAt: 'then', gmailDisconnectedBy: 'admin-1' });
        expect((await meta()).gmail).toEqual(NOT_CONNECTED);
    });

    it('says not connected for older settings on the company document, and for none at all', async () => {
        expect(await meta()).toEqual(expect.objectContaining({ smtpHost: '', gmail: NOT_CONNECTED }));

        mockStore.docs.set('companies/co-1', { companyName: 'Artificial Carrier', emailSettings: { smtpHost: 'legacy.example.test' } });
        expect(await meta()).toEqual(expect.objectContaining({ smtpHost: 'legacy.example.test', gmail: NOT_CONNECTED }));
    });

    it('stays admin-only', async () => {
        assertCompanyAdminStrict.mockImplementation(async () => {
            throw Object.assign(new Error('Company admin access required.'), { code: 'permission-denied' });
        });
        await expect(meta()).rejects.toMatchObject({ code: 'permission-denied' });
    });
});
