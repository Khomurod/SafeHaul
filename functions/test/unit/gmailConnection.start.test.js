/**
 * `startGmailConnection`: who may start connecting Gmail, from which site, and
 * the one-time state and consent-page address it answers. The harness is
 * `gmailConnection.support.js`.
 */
jest.mock('firebase-functions/v2/https', () => require('./gmailConnection.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./gmailConnection.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn() }));
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAdminStrict: jest.fn() }));
jest.mock('../../shared/secretStore', () => ({ readLatestSecret: jest.fn() }));

const crypto = require('crypto');
const { startGmailConnection } = require('../../gmailConnection');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAdminStrict } = require('../../shared/companyAccess');
const { readLatestSecret } = require('../../shared/secretStore');
const { ADMIN, CLIENT_ID, callFrom, mock, resetGmailHarness } = require('./gmailConnection.support');

const start = (options = {}) => startGmailConnection(callFrom({ data: { companyId: 'co-1' }, ...options }));
const storedStates = () => [...mock.docs.entries()].filter(([path]) => path.startsWith('oauth_states/'));

beforeEach(resetGmailHarness);
afterEach(() => jest.restoreAllMocks());

describe('startGmailConnection', () => {
    it("answers Google's consent page and stores the state under its hash, for ten minutes", async () => {
        const before = Date.now();
        const { url } = await start();
        const address = new URL(url);
        const state = address.searchParams.get('state');

        expect(`${address.origin}${address.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        expect(address.searchParams.get('client_id')).toBe(CLIENT_ID);
        expect(address.searchParams.get('redirect_uri')).toBe('https://app.safehaul.io/oauth/google/callback');
        expect(address.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/gmail.send');
        expect(address.searchParams.get('code_challenge_method')).toBe('S256');

        const states = storedStates();
        expect(states).toHaveLength(1);
        const [path, stored] = states[0];
        // The database holds the state's hash, never the state.
        expect(path).toBe(`oauth_states/${crypto.createHash('sha256').update(state).digest('hex')}`);
        expect(JSON.stringify(stored)).not.toContain(state);
        expect(stored).toMatchObject({
            kind: 'gmail',
            uid: ADMIN,
            companyId: 'co-1',
            redirectUri: 'https://app.safehaul.io/oauth/google/callback',
            createdAt: '__server_timestamp__',
        });
        expect(crypto.createHash('sha256').update(stored.codeVerifier).digest('base64url'))
            .toBe(address.searchParams.get('code_challenge'));
        const lifetime = stored.expiresAt.toMillis() - before;
        expect(lifetime).toBeGreaterThanOrEqual(10 * 60 * 1000);
        expect(lifetime).toBeLessThan(10 * 60 * 1000 + 5000);

        expect(checkRateLimit).toHaveBeenCalledWith(`gmail_connect_${ADMIN}`, 10, 600, 'closed');
        expect(assertCompanyAdminStrict).toHaveBeenCalledWith(ADMIN, 'co-1');
    });

    it.each([
        ['https://app.safehaul.io', 'https://app.safehaul.io/oauth/google/callback'],
        ['https://safehaul-app-production.web.app', 'https://app.safehaul.io/oauth/google/callback'],
        ['https://truckerapp-system.web.app', 'https://truckerapp-system.web.app/oauth/google/callback'],
        ['https://truckerapp-system.firebaseapp.com', 'https://truckerapp-system.web.app/oauth/google/callback'],
    ])('from %s returns to %s', async (origin, redirectUri) => {
        const { url } = await start({ origin });
        expect(new URL(url).searchParams.get('redirect_uri')).toBe(redirectUri);
        expect(storedStates()[0][1].redirectUri).toBe(redirectUri);
    });

    it('takes the return address from the Origin, never from the request', async () => {
        const { url } = await start({ data: { companyId: 'co-1', redirectUri: 'https://evil.example/cb' } });
        expect(new URL(url).searchParams.get('redirect_uri')).toBe('https://app.safehaul.io/oauth/google/callback');
    });

    it.each([null, 'https://evil.example', 'http://localhost:5000'])('refuses the origin %p and stores nothing', async (origin) => {
        await expect(start({ origin })).rejects.toMatchObject({
            code: 'failed-precondition',
            message: 'Open SafeHaul at app.safehaul.io to connect Gmail.',
        });
        expect(storedStates()).toEqual([]);
    });

    it('refuses a caller who is not a company admin', async () => {
        assertCompanyAdminStrict.mockImplementation(async () => {
            throw Object.assign(new Error('Company admin access required.'), { code: 'permission-denied' });
        });
        await expect(start()).rejects.toMatchObject({ code: 'permission-denied' });
        expect(storedStates()).toEqual([]);
    });

    it('refuses while the switch is off, and when it was never switched on', async () => {
        mock.docs.set('companies/co-1', { companyName: 'Artificial Carrier', features: { gmailSending: false } });
        await expect(start()).rejects.toMatchObject({
            code: 'failed-precondition',
            message: 'Sending from Gmail is not switched on for this company.',
        });
        mock.docs.set('companies/co-1', { companyName: 'Artificial Carrier' });
        await expect(start()).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(storedStates()).toEqual([]);
    });

    it("reads the switch itself when a super admin's check hands back no company", async () => {
        assertCompanyAdminStrict.mockImplementation(async () => undefined);
        await expect(start()).resolves.toHaveProperty('url');
        mock.docs.set('companies/co-1', { companyName: 'Artificial Carrier' });
        await expect(start()).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('refuses when rate-limited, before any other check', async () => {
        checkRateLimit.mockImplementation(async () => false);
        await expect(start()).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(assertCompanyAdminStrict).not.toHaveBeenCalled();
    });

    it('refuses a signed-out caller and a missing company', async () => {
        await expect(start({ uid: null })).rejects.toMatchObject({ code: 'unauthenticated' });
        await expect(start({ data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(start({ data: { companyId: 'co-1/x' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('says Gmail is not set up while the OAuth client is missing, and stores nothing', async () => {
        readLatestSecret.mockImplementation(async () => null);
        await expect(start()).rejects.toMatchObject({
            code: 'failed-precondition',
            message: 'Sending from Gmail is not set up yet.',
        });
        expect(storedStates()).toEqual([]);
        expect(console.error.mock.calls.flat().join(' ')).toContain('gmail-not-configured');
    });
});

describe('oauth_states and gmail_grants retention', () => {
    it('declares the TTL policy that deletes a state once it has expired', () => {
        const fs = require('fs');
        const path = require('path');
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../firestore.indexes.json'), 'utf8'));
        const override = (config.fieldOverrides || []).find((entry) => (
            entry.collectionGroup === 'oauth_states' && entry.fieldPath === 'expiresAt'
        ));

        expect(override).toEqual({ collectionGroup: 'oauth_states', fieldPath: 'expiresAt', ttl: true, indexes: [] });
    });

    it('declares the TTL policy that deletes an emptied grant list once its revoke window has passed', () => {
        const fs = require('fs');
        const path = require('path');
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../firestore.indexes.json'), 'utf8'));
        const override = (config.fieldOverrides || []).find((entry) => (
            entry.collectionGroup === 'gmail_grants' && entry.fieldPath === 'expiresAt'
        ));

        expect(override).toEqual({ collectionGroup: 'gmail_grants', fieldPath: 'expiresAt', ttl: true, indexes: [] });
    });
});
