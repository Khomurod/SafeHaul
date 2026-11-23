/**
 * Google's OAuth web-server flow for "Send from Gmail": a company admin lets
 * SafeHaul send as one Google account (`gmail.send`), and the server keeps that
 * account's refresh token.
 *
 * - **The OAuth client** (its ID and secret) is read at run time from Secret
 *   Manager as GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET and kept for
 *   ten minutes, as the alerts bot token is (`ops/alertSettings.js`). They are
 *   not bound with `secrets: [...]`, so no deploy depends on who may read them:
 *   while they are missing or unreadable only Gmail stops, with the code
 *   `gmail-not-configured`.
 * - **The return address** is one of the two registered with that client,
 *   chosen from the request's Origin and never from the request body.
 * - **Nothing here logs or returns** a token, a code, an email address or
 *   Google's error text. A failure carries a fixed code: ours, or Google's own
 *   OAuth error code (`invalid_grant`, `admin_policy_enforced`, ...).
 */
const crypto = require('crypto');
const { readLatestSecret } = require('../secretStore');

const CLIENT_ID_SECRET = 'GMAIL_OAUTH_CLIENT_ID';
const CLIENT_SECRET_SECRET = 'GMAIL_OAUTH_CLIENT_SECRET';
const CLIENT_CACHE_MS = 10 * 60 * 1000;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const TIMEOUT_MS = 15 * 1000;

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
/** Only what sending needs: who the account is, and permission to send as it. */
const SCOPES = Object.freeze(['openid', 'email', GMAIL_SEND_SCOPE]);
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/** The page Google returns the admin to, which finishes the connection. */
const RETURN_PATH = '/oauth/google/callback';

/**
 * Each of the app's hosts (`shared/appOrigin.js`, `APP_HOSTS`) and the
 * registered return address it uses: Production's hosts return to
 * app.safehaul.io, Testing's to truckerapp-system.web.app. A Map, so a host
 * named like an Object property (`constructor`) finds nothing.
 */
const RETURN_ORIGIN_BY_HOST = new Map([
    ['app.safehaul.io', 'https://app.safehaul.io'],
    ['safehaul-app-production.web.app', 'https://app.safehaul.io'],
    ['safehaul-app-production.firebaseapp.com', 'https://app.safehaul.io'],
    ['truckerapp-system.web.app', 'https://truckerapp-system.web.app'],
    ['truckerapp-system.firebaseapp.com', 'https://truckerapp-system.web.app'],
]);

/** Google's account id (`sub`): it names a `gmail_grants` document, so no path separator. */
const SUB_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;
const GOOGLE_ERROR_CODE = /^[a-z_]{1,64}$/;

class GmailOAuthError extends Error {
    /**
     * @param {string} code a fixed code, ours or Google's: never free text
     * @param {{ status?: number|null }} [details]
     */
    constructor(code, { status = null } = {}) {
        super(`Gmail OAuth failed: ${code}`);
        this.name = 'GmailOAuthError';
        this.code = code;
        this.status = status;
    }
}

let cachedClient = null;

/** The OAuth client's ID and secret, or `gmail-not-configured` when either cannot be read. */
async function readGmailClient({ client } = {}) {
    if (cachedClient && Date.now() < cachedClient.expiresAt) return cachedClient.value;
    let stored;
    try {
        stored = await Promise.all([
            readLatestSecret(CLIENT_ID_SECRET, { client }),
            readLatestSecret(CLIENT_SECRET_SECRET, { client }),
        ]);
    } catch (error) {
        // Not readable by this function yet, or Secret Manager is down.
        console.error('[gmailOAuth] gmail-not-configured: the OAuth client could not be read', { code: error?.code ?? 'error' });
        throw new GmailOAuthError('gmail-not-configured');
    }
    const [clientId, clientSecret] = stored.map((value) => (typeof value === 'string' ? value.trim() : ''));
    if (!clientId || !clientSecret) {
        console.error('[gmailOAuth] gmail-not-configured: the OAuth client is not in Secret Manager');
        throw new GmailOAuthError('gmail-not-configured');
    }
    const value = Object.freeze({ clientId, clientSecret });
    cachedClient = { value, expiresAt: Date.now() + CLIENT_CACHE_MS };
    return value;
}

/** The registered return address for a request from `origin`; null for any other origin. */
function gmailRedirectUriFor(origin) {
    try {
        const url = new URL(String(origin || '').trim());
        const plain = url.protocol === 'https:' && !url.port && !url.username && !url.password;
        const returnOrigin = plain ? RETURN_ORIGIN_BY_HOST.get(url.hostname.toLowerCase()) : undefined;
        return returnOrigin ? `${returnOrigin}${RETURN_PATH}` : null;
    } catch {
        return null;
    }
}

const randomToken = () => crypto.randomBytes(32).toString('base64url');

/** The id a state is stored under: its SHA-256, so the database never holds a live state. */
function stateIdFor(state) {
    return crypto.createHash('sha256').update(String(state)).digest('hex');
}

/** A new one-time `state` (32 random bytes) and its document id. */
function newState() {
    const state = randomToken();
    return { state, stateId: stateIdFor(state) };
}

/** PKCE (S256): the verifier stays on the server, Google gets its hash. */
function newPkcePair() {
    const codeVerifier = randomToken();
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    return { codeVerifier, codeChallenge };
}

/**
 * Google's consent page. `access_type=offline` and `prompt=consent` make Google
 * issue a refresh token every time; `select_account` lets the admin pick a
 * shared mailbox, so there is no `login_hint`. There is no
 * `include_granted_scopes`, so the token holds only these scopes.
 */
function buildAuthUrl({ clientId, redirectUri, state, codeChallenge }) {
    const query = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent select_account',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });
    // A space as %20, as Google's own examples write it; a literal `+` is already %2B.
    return `${AUTH_ENDPOINT}?${query.toString().replace(/\+/g, '%20')}`;
}

/** POSTs a form to Google and gives up after 15 s: the JSON answer, or a GmailOAuthError. */
async function postForm(url, form, { fetchImpl } = {}) {
    const send = fetchImpl || globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    let payload = null;
    try {
        response = await send(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(form).toString(),
            signal: controller.signal,
        });
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
    } catch {
        // Not the error itself: a failed request can echo what it sent.
        throw new GmailOAuthError('google-unreachable');
    } finally {
        clearTimeout(timer);
    }
    if (!response.ok) {
        const googleCode = typeof payload?.error === 'string' && GOOGLE_ERROR_CODE.test(payload.error)
            ? payload.error
            : 'google-refused';
        throw new GmailOAuthError(googleCode, { status: response.status });
    }
    return payload || {};
}

const scopesOf = (scope) => (typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean) : []);

/** Exchanges Google's one-time code, with the PKCE verifier and the same return address. */
async function exchangeCode({ code, codeVerifier, redirectUri }, options = {}) {
    const { clientId, clientSecret } = await readGmailClient(options);
    const answer = await postForm(TOKEN_ENDPOINT, {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
    }, options);
    return {
        refreshToken: typeof answer.refresh_token === 'string' ? answer.refresh_token : null,
        idToken: typeof answer.id_token === 'string' ? answer.id_token : null,
        scopes: scopesOf(answer.scope),
    };
}

/** A fresh access token for a stored refresh token. */
async function refreshAccessToken(refreshToken, options = {}) {
    const { clientId, clientSecret } = await readGmailClient(options);
    const answer = await postForm(TOKEN_ENDPOINT, {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    }, options);
    if (typeof answer.access_token !== 'string' || !answer.access_token) throw new GmailOAuthError('google-refused');
    return {
        accessToken: answer.access_token,
        expiresIn: Number(answer.expires_in) || null,
        scopes: scopesOf(answer.scope),
    };
}

/**
 * Revokes a token at Google, which ends every grant that Google account gave
 * SafeHaul, for every company. Never throws: it answers an outcome code.
 */
async function revokeToken(token, options = {}) {
    try {
        await postForm(REVOKE_ENDPOINT, { token }, options);
        return 'revoked';
    } catch (error) {
        // Google no longer honours it: what revoking wanted.
        if (error?.code === 'invalid_token') return 'already-invalid';
        return error?.code || 'failed';
    }
}

/**
 * The Google account an ID token names. It came straight from Google's token
 * endpoint over TLS, in exchange for the client secret, so its signature is not
 * checked again (Google's OpenID Connect guide); its claims are.
 */
function decodeIdToken(idToken, { clientId, now = Date.now() } = {}) {
    let claims;
    try {
        claims = JSON.parse(Buffer.from(String(idToken || '').split('.')[1], 'base64url').toString('utf8'));
    } catch {
        throw new GmailOAuthError('id-token-invalid');
    }
    const audiences = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
    const valid = typeof clientId === 'string' && clientId !== ''
        && audiences.includes(clientId)
        && GOOGLE_ISSUERS.has(claims.iss)
        && Number(claims.exp) * 1000 > now
        && typeof claims.sub === 'string' && SUB_PATTERN.test(claims.sub)
        && typeof claims.email === 'string' && claims.email.trim() !== '';
    if (!valid) throw new GmailOAuthError('id-token-invalid');
    if (claims.email_verified !== true) throw new GmailOAuthError('email-unverified');
    return { sub: claims.sub, email: claims.email.trim() };
}

module.exports = {
    CLIENT_ID_SECRET,
    CLIENT_SECRET_SECRET,
    GMAIL_SEND_SCOPE,
    GmailOAuthError,
    RETURN_ORIGIN_BY_HOST,
    RETURN_PATH,
    SCOPES,
    SUB_PATTERN,
    buildAuthUrl,
    decodeIdToken,
    exchangeCode,
    gmailRedirectUriFor,
    newPkcePair,
    newState,
    readGmailClient,
    refreshAccessToken,
    revokeToken,
    stateIdFor,
    _resetClientCacheForTesting: () => { cachedClient = null; },
};
