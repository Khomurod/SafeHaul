/**
 * Google's OAuth web-server flow for Send from Gmail (`shared/gmail/oauthClient.js`):
 * the requests' shapes, the OAuth client read at run time and cached, the
 * return addresses, and the ID token's checks. Every id, token and address
 * below is artificial; no request leaves the process.
 */
jest.mock('../../shared/secretStore', () => ({ readLatestSecret: jest.fn() }));

const crypto = require('crypto');
const secretStore = require('../../shared/secretStore');
const { APP_HOSTS } = require('../../shared/appOrigin');
const oauth = require('../../shared/gmail/oauthClient');

const CLIENT_ID = 'artificial-client.apps.googleusercontent.com';
const CLIENT_SECRET = 'artificial-client-secret';
const SECRETS = { GMAIL_OAUTH_CLIENT_ID: CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET: CLIENT_SECRET };

/** A `fetch` double that answers `status` and `body`, and records each request. */
function fakeFetch(status, body) {
    const calls = [];
    const fetchImpl = jest.fn(async (url, init) => {
        calls.push({ url, init, form: Object.fromEntries(new URLSearchParams(init.body)) });
        return { ok: status >= 200 && status < 300, status, json: async () => body };
    });
    return { fetchImpl, calls };
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const idToken = (claims) => `${encode({ alg: 'RS256' })}.${encode(claims)}.artificial-signature`;
const NOW = Date.parse('2026-11-23T12:00:00Z');
const goodClaims = (overrides = {}) => ({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: NOW / 1000 + 3600,
    sub: '109876543210',
    email: 'hiring@example.test',
    email_verified: true,
    ...overrides,
});

beforeEach(() => {
    jest.resetAllMocks();
    oauth._resetClientCacheForTesting();
    secretStore.readLatestSecret.mockImplementation(async (name) => SECRETS[name] ?? null);
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('the OAuth client, read at run time', () => {
    it('reads both secrets by name, trims them, and keeps them for ten minutes', async () => {
        secretStore.readLatestSecret.mockImplementation(async (name) => `${SECRETS[name]}\n`);
        const now = jest.spyOn(Date, 'now').mockReturnValue(NOW);

        expect(await oauth.readGmailClient()).toEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
        expect(secretStore.readLatestSecret.mock.calls.map(([name]) => name).sort())
            .toEqual(['GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET']);

        now.mockReturnValue(NOW + 9 * 60 * 1000);
        await oauth.readGmailClient();
        expect(secretStore.readLatestSecret).toHaveBeenCalledTimes(2);

        now.mockReturnValue(NOW + 11 * 60 * 1000);
        await oauth.readGmailClient();
        expect(secretStore.readLatestSecret).toHaveBeenCalledTimes(4);
    });

    it.each([
        ['the secret does not exist', async (name) => (name === 'GMAIL_OAUTH_CLIENT_SECRET' ? null : SECRETS[name])],
        ['the secret is blank', async (name) => (name === 'GMAIL_OAUTH_CLIENT_ID' ? '  ' : SECRETS[name])],
        ['the function may not read it', async () => { throw Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 }); }],
    ])('answers gmail-not-configured when %s, and logs no value', async (_case, read) => {
        secretStore.readLatestSecret.mockImplementation(read);
        await expect(oauth.readGmailClient()).rejects.toMatchObject({ code: 'gmail-not-configured' });
        expect(JSON.stringify(console.error.mock.calls)).not.toContain(CLIENT_SECRET);
        // Not cached: the next call reads again, so a new secret works at once.
        secretStore.readLatestSecret.mockImplementation(async (name) => SECRETS[name]);
        await expect(oauth.readGmailClient()).resolves.toEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    });
});

describe('return addresses', () => {
    it.each([
        ['https://app.safehaul.io', 'https://app.safehaul.io/oauth/google/callback'],
        ['https://safehaul-app-production.web.app', 'https://app.safehaul.io/oauth/google/callback'],
        ['https://safehaul-app-production.firebaseapp.com', 'https://app.safehaul.io/oauth/google/callback'],
        ['https://truckerapp-system.web.app', 'https://truckerapp-system.web.app/oauth/google/callback'],
        ['https://truckerapp-system.firebaseapp.com', 'https://truckerapp-system.web.app/oauth/google/callback'],
        ['https://APP.SAFEHAUL.IO', 'https://app.safehaul.io/oauth/google/callback'],
    ])('%s returns to %s', (origin, expected) => {
        expect(oauth.gmailRedirectUriFor(origin)).toBe(expected);
    });

    it.each([
        undefined, '', 'null', 'not a url', 'http://app.safehaul.io', 'https://app.safehaul.io:8443',
        'https://evil.example', 'https://app.safehaul.io.evil.example', 'https://user@app.safehaul.io',
        'http://localhost:5000', 'https://constructor', 'https://__proto__',
    ])('refuses %p', (origin) => {
        expect(oauth.gmailRedirectUriFor(origin)).toBeNull();
    });

    it('covers exactly the app hosts appOrigin trusts, and returns only to the two registered addresses', () => {
        expect([...oauth.RETURN_ORIGIN_BY_HOST.keys()].sort()).toEqual([...APP_HOSTS].sort());
        expect(new Set(oauth.RETURN_ORIGIN_BY_HOST.values()))
            .toEqual(new Set(['https://app.safehaul.io', 'https://truckerapp-system.web.app']));
    });
});

describe('the consent page address', () => {
    it('asks for sending only, offline, with PKCE S256 and the one-time state', () => {
        const { state, stateId } = oauth.newState();
        const { codeVerifier, codeChallenge } = oauth.newPkcePair();
        const url = new URL(oauth.buildAuthUrl({
            clientId: CLIENT_ID,
            redirectUri: 'https://app.safehaul.io/oauth/google/callback',
            state,
            codeChallenge,
        }));

        expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            client_id: CLIENT_ID,
            redirect_uri: 'https://app.safehaul.io/oauth/google/callback',
            response_type: 'code',
            scope: 'openid email https://www.googleapis.com/auth/gmail.send',
            access_type: 'offline',
            prompt: 'consent select_account',
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });
        expect(url.search).toContain('scope=openid%20email%20');
        expect(url.search).not.toContain('include_granted_scopes');
        expect(url.search).not.toContain('login_hint');

        expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(stateId).toBe(crypto.createHash('sha256').update(state).digest('hex'));
        expect(oauth.stateIdFor(state)).toBe(stateId);
        expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(codeChallenge).toBe(crypto.createHash('sha256').update(codeVerifier).digest('base64url'));
        expect(oauth.newState().state).not.toBe(state);
    });
});

describe('requests to Google', () => {
    it('exchanges a code with the verifier, the client and the same return address', async () => {
        const { fetchImpl, calls } = fakeFetch(200, {
            access_token: 'artificial-access', refresh_token: 'artificial-refresh', id_token: 'a.b.c',
            scope: 'openid https://www.googleapis.com/auth/gmail.send email', expires_in: 3599,
        });
        const tokens = await oauth.exchangeCode({
            code: 'artificial-code', codeVerifier: 'artificial-verifier', redirectUri: 'https://app.safehaul.io/oauth/google/callback',
        }, { fetchImpl });

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
        expect(calls[0].init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
        expect(calls[0].form).toEqual({
            code: 'artificial-code',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: 'https://app.safehaul.io/oauth/google/callback',
            grant_type: 'authorization_code',
            code_verifier: 'artificial-verifier',
        });
        // The access token is not kept: sending gets its own (`refreshAccessToken`).
        expect(tokens).toEqual({
            refreshToken: 'artificial-refresh',
            idToken: 'a.b.c',
            scopes: ['openid', 'https://www.googleapis.com/auth/gmail.send', 'email'],
        });
    });

    it('refreshes an access token with the refresh token', async () => {
        const { fetchImpl, calls } = fakeFetch(200, { access_token: 'artificial-access', expires_in: 3599, scope: 'https://www.googleapis.com/auth/gmail.send' });
        await expect(oauth.refreshAccessToken('artificial-refresh', { fetchImpl })).resolves.toEqual({
            accessToken: 'artificial-access', expiresIn: 3599, scopes: ['https://www.googleapis.com/auth/gmail.send'],
        });
        expect(calls[0].form).toEqual({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: 'artificial-refresh', grant_type: 'refresh_token',
        });
    });

    it("carries Google's error code, never its description", async () => {
        const { fetchImpl } = fakeFetch(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        const failure = await oauth.refreshAccessToken('artificial-refresh', { fetchImpl }).catch((error) => error);
        expect(failure).toBeInstanceOf(oauth.GmailOAuthError);
        expect(failure).toMatchObject({ code: 'invalid_grant', status: 400 });
        expect(failure.message).not.toContain('expired or revoked');
    });

    it('answers google-refused for an error it cannot read, and google-unreachable when the request fails', async () => {
        const { fetchImpl } = fakeFetch(500, { error: 'Something <odd>' });
        await expect(oauth.refreshAccessToken('x', { fetchImpl })).rejects.toMatchObject({ code: 'google-refused', status: 500 });

        const down = jest.fn(async () => { throw new Error('connect ECONNREFUSED with the request body'); });
        const failure = await oauth.exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' }, { fetchImpl: down }).catch((error) => error);
        expect(failure).toMatchObject({ code: 'google-unreachable' });
        expect(failure.message).not.toContain('ECONNREFUSED');
    });

    it('answers google-unreachable when fifteen seconds run out while the answer is still arriving', async () => {
        jest.useFakeTimers();
        try {
            const slow = jest.fn(async (_url, init) => ({
                ok: true,
                status: 200,
                json: () => new Promise((_resolve, reject) => {
                    init.signal.addEventListener('abort', () => reject(new Error('The operation was aborted.')));
                }),
            }));
            const pending = oauth.exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' }, { fetchImpl: slow });
            const outcome = expect(pending).rejects.toMatchObject({ code: 'google-unreachable' });
            await jest.advanceTimersByTimeAsync(15 * 1000);
            await outcome;
        } finally {
            jest.useRealTimers();
        }
    });

    it('does not call Google when the client is not configured', async () => {
        secretStore.readLatestSecret.mockImplementation(async () => null);
        const { fetchImpl } = fakeFetch(200, {});
        await expect(oauth.exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' }, { fetchImpl }))
            .rejects.toMatchObject({ code: 'gmail-not-configured' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('revokes a token, and answers an outcome code instead of throwing', async () => {
        const ok = fakeFetch(200, null);
        await expect(oauth.revokeToken('artificial-refresh', { fetchImpl: ok.fetchImpl })).resolves.toBe('revoked');
        expect(ok.calls[0].url).toBe('https://oauth2.googleapis.com/revoke');
        expect(ok.calls[0].form).toEqual({ token: 'artificial-refresh' });
        // Revoking needs no client secret.
        expect(secretStore.readLatestSecret).not.toHaveBeenCalled();

        await expect(oauth.revokeToken('x', { fetchImpl: fakeFetch(400, { error: 'invalid_token' }).fetchImpl })).resolves.toBe('already-invalid');
        await expect(oauth.revokeToken('x', { fetchImpl: fakeFetch(503, null).fetchImpl })).resolves.toBe('google-refused');
        await expect(oauth.revokeToken('x', { fetchImpl: jest.fn(async () => { throw new Error('down'); }) })).resolves.toBe('google-unreachable');
    });
});

describe('the ID token', () => {
    const decode = (claims) => oauth.decodeIdToken(idToken(claims), { clientId: CLIENT_ID, now: NOW });

    it('names the Google account', () => {
        expect(decode(goodClaims())).toEqual({ sub: '109876543210', email: 'hiring@example.test' });
        expect(decode(goodClaims({ iss: 'accounts.google.com' })).sub).toBe('109876543210');
    });

    it.each([
        ['another client', { aud: 'someone-else.apps.googleusercontent.com' }],
        ['another issuer', { iss: 'https://evil.example' }],
        ['an expired token', { exp: NOW / 1000 - 1 }],
        ['no account id', { sub: undefined }],
        ['an account id that is a path', { sub: '123/456' }],
        ['no email', { email: '' }],
    ])('refuses %s', (_case, overrides) => {
        expect(() => decode(goodClaims(overrides))).toThrow(expect.objectContaining({ code: 'id-token-invalid' }));
    });

    it('refuses an unverified email', () => {
        expect(() => decode(goodClaims({ email_verified: false }))).toThrow(expect.objectContaining({ code: 'email-unverified' }));
        expect(() => decode(goodClaims({ email_verified: 'true' }))).toThrow(expect.objectContaining({ code: 'email-unverified' }));
    });

    it('refuses a token it cannot read, and any token when it has no client id to compare', () => {
        for (const broken of [undefined, '', 'one-part', 'a.!!!.c', `a.${Buffer.from('null').toString('base64url')}.c`]) {
            expect(() => oauth.decodeIdToken(broken, { clientId: CLIENT_ID, now: NOW }))
                .toThrow(expect.objectContaining({ code: 'id-token-invalid' }));
        }
        expect(() => oauth.decodeIdToken(idToken(goodClaims({ aud: undefined })), { now: NOW }))
            .toThrow(expect.objectContaining({ code: 'id-token-invalid' }));
    });
});
