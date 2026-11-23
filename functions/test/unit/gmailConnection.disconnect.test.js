/**
 * `disconnectGmail`: the company's Gmail fields go, the SMTP settings stay, and
 * the token is revoked at Google only when no other company uses that Google
 * account. The harness is `gmailConnection.support.js`.
 */
jest.mock('firebase-functions/v2/https', () => require('./gmailConnection.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./gmailConnection.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn() }));
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAdminStrict: jest.fn() }));
jest.mock('../../shared/secretStore', () => ({ readLatestSecret: jest.fn() }));

const { disconnectGmail, GMAIL_FIELDS } = require('../../gmailConnection');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAdminStrict } = require('../../shared/companyAccess');
const { sealPassword } = require('../../shared/smtpSettings');
const {
    ADMIN, EMAIL_CONFIG, callFrom, commitLate, google, loggedText, mock, resetGmailHarness, revokedTokens,
} = require('./gmailConnection.support');

const disconnect = (options = {}) => disconnectGmail(callFrom({ data: { companyId: 'co-1' }, ...options }));
const config = () => mock.docs.get(EMAIL_CONFIG('co-1'));

/** co-1 sends from Google account 1001, which `holders` hold. */
function connected(holders = ['co-1']) {
    mock.docs.set(EMAIL_CONFIG('co-1'), {
        ...config(),
        provider: 'gmail',
        gmailEmail: 'hiring@example.test',
        gmailSub: '1001',
        gmailRefreshToken: sealPassword('artificial-refresh-1001'),
        gmailScopes: ['email', 'openid', 'https://www.googleapis.com/auth/gmail.send'],
        gmailConnectedAt: 'then',
        gmailConnectedBy: 'admin-0',
        gmailStatus: 'needs_reconnect',
        gmailStatusReason: 'invalid_grant',
        gmailStatusAt: 'then',
    });
    mock.docs.set('gmail_grants/1001', { companyIds: holders });
}

beforeEach(resetGmailHarness);
afterEach(() => jest.restoreAllMocks());

describe('disconnectGmail', () => {
    it('deletes every Gmail field, keeps the SMTP settings, and revokes the last holder\'s token', async () => {
        connected();
        await expect(disconnect()).resolves.toEqual({ disconnected: true });

        const stored = config();
        for (const field of [...GMAIL_FIELDS, 'provider']) expect(stored).not.toHaveProperty(field);
        expect(stored).toMatchObject({
            smtpHost: 'smtp.example.test',
            smtpPass: 'enc:v1:stored-smtp-password',
            gmailDisconnectedAt: '__server_timestamp__',
            gmailDisconnectedBy: ADMIN,
        });
        const window = mock.docs.get('gmail_grants/1001');
        expect(window).toMatchObject({ companyIds: [], updatedAt: '__server_timestamp__' });
        expect(window.revokingUntil.toMillis()).toBeGreaterThan(Date.now() + 50 * 1000);
        expect(window.expiresAt.toMillis()).toBe(window.revokingUntil.toMillis());
        expect(revokedTokens()).toEqual(['artificial-refresh-1001']);
        expect(loggedText()).not.toMatch(/artificial-refresh|hiring@example\.test/);
        expect(checkRateLimit).toHaveBeenCalledWith(`gmail_disconnect_${ADMIN}`, 10, 600, 'closed');
    });

    it('skips the revoke when its transaction committed too late: less than 45 seconds of the window left', async () => {
        connected();
        commitLate(16 * 1000);
        await expect(disconnect()).resolves.toEqual({ disconnected: true });

        expect(revokedTokens()).toEqual([]);
        expect(config().gmailRefreshToken).toBeUndefined();
        expect(mock.docs.get('gmail_grants/1001').companyIds).toEqual([]);
        expect(loggedText()).toContain('committed too late');
    });

    it('still revokes after a commit that took a moment', async () => {
        connected();
        commitLate(10 * 1000);
        await disconnect();
        expect(revokedTokens()).toEqual(['artificial-refresh-1001']);
    });

    it('does not revoke while another company still uses that Google account', async () => {
        connected(['co-2', 'co-1']);
        await disconnect();

        expect(revokedTokens()).toEqual([]);
        expect(mock.docs.get('gmail_grants/1001').companyIds).toEqual(['co-2']);
        expect(config().gmailRefreshToken).toBeUndefined();
    });

    it('succeeds when nothing is connected, and writes nothing', async () => {
        const before = config();
        await expect(disconnect()).resolves.toEqual({ disconnected: true });
        await expect(disconnectGmail(callFrom({ data: { companyId: 'co-2' } }))).resolves.toEqual({ disconnected: true });

        expect(config()).toEqual(before);
        expect(mock.docs.get(EMAIL_CONFIG('co-2'))).toBeUndefined();
        expect(google.requests).toEqual([]);
    });

    it('succeeds again after a disconnect', async () => {
        connected();
        await disconnect();
        await expect(disconnect()).resolves.toEqual({ disconnected: true });
        expect(revokedTokens()).toHaveLength(1);
    });

    it('still disconnects when Google cannot revoke: the token is already gone from SafeHaul', async () => {
        connected();
        google.revokeStatus = 503;
        await expect(disconnect()).resolves.toEqual({ disconnected: true });
        expect(config().gmailRefreshToken).toBeUndefined();
        expect(loggedText()).toContain('google-refused');
    });

    it('deletes a token stored without an account id, says so, and does not revoke it', async () => {
        connected();
        mock.docs.set(EMAIL_CONFIG('co-1'), { ...config(), gmailSub: undefined });
        await expect(disconnect()).resolves.toEqual({ disconnected: true });

        expect(config().gmailRefreshToken).toBeUndefined();
        expect(revokedTokens()).toEqual([]);
        expect(loggedText()).toContain('deleted, not revoked');
    });

    it('needs no OAuth client to disconnect', async () => {
        connected();
        require('../../shared/secretStore').readLatestSecret.mockImplementation(async () => null);
        await expect(disconnect()).resolves.toEqual({ disconnected: true });
        expect(revokedTokens()).toEqual(['artificial-refresh-1001']);
    });

    it('refuses a caller who is not a company admin, and changes nothing', async () => {
        connected();
        assertCompanyAdminStrict.mockImplementation(async () => {
            throw Object.assign(new Error('Company admin access required.'), { code: 'permission-denied' });
        });
        await expect(disconnect()).rejects.toMatchObject({ code: 'permission-denied' });
        expect(config().provider).toBe('gmail');
        expect(google.requests).toEqual([]);
    });

    it('refuses when rate-limited, a signed-out caller and a missing company', async () => {
        checkRateLimit.mockImplementation(async () => false);
        await expect(disconnect()).rejects.toMatchObject({ code: 'resource-exhausted' });
        await expect(disconnect({ uid: null })).rejects.toMatchObject({ code: 'unauthenticated' });
        await expect(disconnect({ data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
    });
});
