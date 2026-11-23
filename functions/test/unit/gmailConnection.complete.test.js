/**
 * `completeGmailConnection`: the one-time state, the same admin, Google's
 * answer checked, the token sealed, and the grant list that decides when an
 * old account's token is revoked. The harness is `gmailConnection.support.js`.
 */
jest.mock('firebase-functions/v2/https', () => require('./gmailConnection.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./gmailConnection.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn() }));
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAdminStrict: jest.fn() }));
jest.mock('../../shared/secretStore', () => ({ readLatestSecret: jest.fn() }));

const { startGmailConnection, completeGmailConnection } = require('../../gmailConnection');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAdminStrict } = require('../../shared/companyAccess');
const { readLatestSecret } = require('../../shared/secretStore');
const { plainPassword, sealPassword } = require('../../shared/smtpSettings');
const {
    ADMIN, CLIENT_ID, CLIENT_SECRET, EMAIL_CONFIG, SEND_SCOPE,
    callFrom, google, grantSending, idTokenFor, loggedText, mock, resetGmailHarness, revokedTokens,
} = require('./gmailConnection.support');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EXPIRED = 'This Gmail connection expired. Start again from Settings → Email.';

/** Starts a connection for co-1 as the admin; the `state` Google would hand back. */
async function startedState(companyId = 'co-1') {
    const { url } = await startGmailConnection(callFrom({ data: { companyId } }));
    return new URL(url).searchParams.get('state');
}

const complete = (state, { uid = ADMIN, code = 'artificial-code' } = {}) => (
    completeGmailConnection(callFrom({ uid, data: { state, code } }))
);
const config = (companyId = 'co-1') => mock.docs.get(EMAIL_CONFIG(companyId));
const grant = (sub) => mock.docs.get(`gmail_grants/${sub}`);
const tokenRequests = () => google.requests.filter((request) => request.url === TOKEN_URL);
const storedStates = () => [...mock.docs.keys()].filter((path) => path.startsWith('oauth_states/'));

/** co-1 already sends from the Google account `sub`, which `holders` hold. */
function connectedBefore(sub, holders = ['co-1']) {
    mock.docs.set(EMAIL_CONFIG('co-1'), {
        ...config(),
        provider: 'gmail',
        gmailEmail: 'old@example.test',
        gmailSub: sub,
        gmailRefreshToken: sealPassword(`old-refresh-${sub}`),
        gmailStatus: 'active',
    });
    mock.docs.set(`gmail_grants/${sub}`, { companyIds: holders });
}

beforeEach(resetGmailHarness);
afterEach(() => jest.restoreAllMocks());

describe('completeGmailConnection connects', () => {
    it('stores the account with its token sealed, and answers only the address', async () => {
        const state = await startedState();
        const stateDoc = mock.docs.get(storedStates()[0]);

        const result = await complete(state);

        expect(result).toEqual({ email: 'hiring@example.test' });
        expect(tokenRequests()).toHaveLength(1);
        expect(tokenRequests()[0].form).toEqual({
            code: 'artificial-code',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: 'https://app.safehaul.io/oauth/google/callback',
            grant_type: 'authorization_code',
            code_verifier: stateDoc.codeVerifier,
        });

        const stored = config();
        expect(stored).toMatchObject({
            provider: 'gmail',
            gmailEmail: 'hiring@example.test',
            gmailSub: '1001',
            gmailScopes: ['email', 'openid', SEND_SCOPE].sort(),
            gmailConnectedAt: '__server_timestamp__',
            gmailConnectedBy: ADMIN,
            gmailStatus: 'active',
            gmailStatusReason: null,
            gmailStatusAt: '__server_timestamp__',
            // The SMTP settings stay, for a disconnect.
            smtpHost: 'smtp.example.test',
            smtpPass: 'enc:v1:stored-smtp-password',
        });
        expect(stored.gmailRefreshToken).toMatch(/^enc:v1:/);
        expect(plainPassword(stored.gmailRefreshToken)).toBe('artificial-refresh-1001');
        expect(JSON.stringify(stored)).not.toContain('artificial-refresh-1001');
        expect(grant('1001')).toEqual({ companyIds: ['co-1'], updatedAt: '__server_timestamp__' });
        expect(storedStates()).toEqual([]);

        expect(JSON.stringify(result)).not.toContain('artificial-refresh');
        expect(loggedText()).not.toMatch(/artificial-refresh|hiring@example\.test|artificial-code/);
        expect(checkRateLimit).toHaveBeenCalledWith(`gmail_complete_${ADMIN}`, 10, 600, 'closed');
    });

    it('clears an earlier disconnect', async () => {
        mock.docs.set(EMAIL_CONFIG('co-1'), { ...config(), gmailDisconnectedAt: 'then', gmailDisconnectedBy: 'someone' });
        await complete(await startedState());
        expect(config().gmailDisconnectedAt).toBeUndefined();
        expect(config().gmailDisconnectedBy).toBeUndefined();
    });
});

describe('the one-time state', () => {
    it('works once: a replayed code is refused', async () => {
        const state = await startedState();
        await complete(state);
        await expect(complete(state)).rejects.toMatchObject({ code: 'failed-precondition', message: EXPIRED });
        expect(tokenRequests()).toHaveLength(1);
    });

    it("refuses another user, leaves the admin's attempt, and calls Google for nobody", async () => {
        const state = await startedState();
        await expect(complete(state, { uid: 'someone-else' })).rejects.toMatchObject({
            code: 'permission-denied',
            message: 'Sign in as the person who started connecting Gmail, then try again.',
        });
        expect(tokenRequests()).toHaveLength(0);
        expect(storedStates()).toHaveLength(1);
        await expect(complete(state)).resolves.toEqual({ email: 'hiring@example.test' });
    });

    it('refuses an expired state, and spends it', async () => {
        const state = await startedState();
        const [path] = storedStates();
        mock.docs.set(path, { ...mock.docs.get(path), expiresAt: { toMillis: () => Date.now() - 1 } });

        await expect(complete(state)).rejects.toMatchObject({ code: 'failed-precondition', message: EXPIRED });
        expect(storedStates()).toEqual([]);
        expect(tokenRequests()).toHaveLength(0);
    });

    it('refuses a state it never issued, and a request without a state or a code', async () => {
        await expect(complete('never-issued')).rejects.toMatchObject({ code: 'failed-precondition', message: EXPIRED });
        await expect(complete('')).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(complete('x', { code: null })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(complete('x', { uid: null })).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('checks the admin again, for the company the state names', async () => {
        const state = await startedState();
        assertCompanyAdminStrict.mockClear();
        assertCompanyAdminStrict.mockImplementation(async () => {
            throw Object.assign(new Error('Company admin access required.'), { code: 'permission-denied' });
        });

        await expect(complete(state)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(assertCompanyAdminStrict).toHaveBeenCalledWith(ADMIN, 'co-1');
        expect(tokenRequests()).toHaveLength(0);
        expect(config().provider).toBeUndefined();
    });
});

describe("Google's answer is checked", () => {
    const refusedWith = async (code, message) => {
        await expect(complete(await startedState())).rejects.toMatchObject({ code, message });
        expect(config().provider).toBeUndefined();
        expect(config().gmailRefreshToken).toBeUndefined();
        expect([...mock.docs.keys()].some((path) => path.startsWith('gmail_grants/'))).toBe(false);
    };

    it('refuses a grant without the send permission', async () => {
        grantSending({ scope: 'openid email' });
        await refusedWith('permission-denied', "Google did not allow SafeHaul to send email. Try again and allow 'Send email on your behalf'.");
    });

    it('refuses an answer without a refresh token', async () => {
        grantSending();
        delete google.token.body.refresh_token;
        await refusedWith('internal', 'Gmail could not be connected. Start again from Settings → Email.');
    });

    it('refuses an ID token for another client', async () => {
        grantSending();
        google.token.body.id_token = idTokenFor({ aud: 'someone-else.apps.googleusercontent.com' });
        await refusedWith('internal', 'Gmail could not be connected. Start again from Settings → Email.');
    });

    it('refuses an unverified email address', async () => {
        grantSending();
        google.token.body.id_token = idTokenFor({ email_verified: false });
        await refusedWith('failed-precondition', "Google has not verified this account's email address, so SafeHaul cannot send from it.");
    });

    it('says the connection expired when Google refuses the code', async () => {
        google.token = { status: 400, body: { error: 'invalid_grant', error_description: 'Bad Request' } };
        await refusedWith('failed-precondition', EXPIRED);
        expect(loggedText()).toContain('invalid_grant');
    });

    it("names the Workspace administrator's block", async () => {
        google.token = { status: 400, body: { error: 'admin_policy_enforced' } };
        await refusedWith('permission-denied', 'Your Google Workspace administrator has blocked SafeHaul. Ask them to allow it.');
    });

    it('says Gmail is not set up when the OAuth client disappeared since the start', async () => {
        const state = await startedState();
        require('../../shared/gmail/oauthClient')._resetClientCacheForTesting();
        readLatestSecret.mockImplementation(async () => null);
        await expect(complete(state)).rejects.toMatchObject({ code: 'failed-precondition', message: 'Sending from Gmail is not set up yet.' });
        expect(tokenRequests()).toHaveLength(0);
    });
});

describe('reconnecting, and the grant list', () => {
    it('the same Google account again: replaces the token and revokes nothing', async () => {
        connectedBefore('1001');
        await complete(await startedState());

        expect(revokedTokens()).toEqual([]);
        expect(plainPassword(config().gmailRefreshToken)).toBe('artificial-refresh-1001');
        expect(grant('1001').companyIds).toEqual(['co-1']);
    });

    it("another account: revokes the old account's token when no other company holds it", async () => {
        connectedBefore('900');
        grantSending({ sub: '1001' });
        await complete(await startedState());

        expect(revokedTokens()).toEqual(['old-refresh-900']);
        expect(grant('900')).toBeUndefined();
        expect(grant('1001').companyIds).toEqual(['co-1']);
        expect(config().gmailSub).toBe('1001');
        expect(loggedText()).not.toContain('old-refresh-900');
    });

    it('another account: keeps the old token when another company still uses that account', async () => {
        connectedBefore('900', ['co-2', 'co-1']);
        await complete(await startedState());

        expect(revokedTokens()).toEqual([]);
        expect(grant('900').companyIds).toEqual(['co-2']);
        expect(grant('1001').companyIds).toEqual(['co-1']);
    });

    it('adds the company to an account another company already holds', async () => {
        mock.docs.set('gmail_grants/1001', { companyIds: ['co-2'] });
        await complete(await startedState());
        expect(grant('1001').companyIds).toEqual(['co-2', 'co-1']);
    });

    it('stays connected when revoking the old token fails', async () => {
        connectedBefore('900');
        google.revokeStatus = 503;
        await expect(complete(await startedState())).resolves.toEqual({ email: 'hiring@example.test' });
        expect(config().gmailSub).toBe('1001');
        expect(loggedText()).toContain('google-refused');
    });
});
