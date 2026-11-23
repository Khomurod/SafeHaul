/**
 * Shared harness for the `gmailConnection.*` suites (Send from Gmail).
 *
 * `jest.mock` is hoisted per file, so each suite registers its own mocks with
 * the factories below; the in-memory store is built here, before the first
 * require, and reset in place, because `gmailConnection.js` destructures
 * `{ admin, db }` when it loads. Google is a `fetch` double that answers the
 * token and revoke endpoints and records every request. Every id, address and
 * token is artificial.
 *
 * `commitLate(ms)` and `stallAfterExchange(ms)` move the clock on at a commit
 * or after the code exchange. `resetGmailHarness()` runs `jest.resetAllMocks()` and then puts back every
 * default the suites rely on: a signed-in admin passes, the rate limit allows,
 * the OAuth client is configured, Google grants sending.
 */

const ENCRYPTION_KEY = 'artificial-key-of-32-characters!';
process.env.SMS_ENCRYPTION_KEY = ENCRYPTION_KEY;

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock();

const CLIENT_ID = 'artificial-client.apps.googleusercontent.com';
const CLIENT_SECRET = 'artificial-client-secret';
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const ADMIN = 'admin-1';
const EMAIL_CONFIG = (companyId) => `companies/${companyId}/system_settings/email_config`;

const httpsMock = () => ({
    onCall: (_options, handler) => handler,
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
});

const firebaseAdminMock = () => ({ admin: mock.admin, db: mock.db });

function seedDocuments() {
    return {
        'companies/co-1': { companyName: 'Artificial Carrier', features: { gmailSending: true } },
        'companies/co-2': { companyName: 'Second Carrier', features: { gmailSending: true } },
        [EMAIL_CONFIG('co-1')]: {
            smtpHost: 'smtp.example.test',
            smtpPort: 587,
            smtpUser: 'ops@example.test',
            smtpPass: 'enc:v1:stored-smtp-password',
            signature: 'Regards',
        },
    };
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** An ID token as Google's token endpoint returns it, for an account (`sub`) and address. */
function idTokenFor({ sub = '1001', email = 'hiring@example.test', ...overrides } = {}) {
    return `${encode({ alg: 'RS256' })}.${encode({
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub,
        email,
        email_verified: true,
        ...overrides,
    })}.artificial-signature`;
}

/**
 * What the Google double answers. `token` is the token endpoint's answer;
 * `requests` records `{ url, form }` for each call, in order.
 */
const google = {
    token: null,
    revokeStatus: 200,
    requests: [],
};

function grantSending({ sub = '1001', email = 'hiring@example.test', refreshToken = `artificial-refresh-${sub}`, scope } = {}) {
    google.token = {
        status: 200,
        body: {
            access_token: 'artificial-access',
            refresh_token: refreshToken,
            id_token: idTokenFor({ sub, email }),
            scope: scope ?? `openid email ${SEND_SCOPE}`,
            expires_in: 3599,
        },
    };
}

async function googleFetch(url, init) {
    const form = Object.fromEntries(new URLSearchParams(init.body));
    google.requests.push({ url, form });
    const answer = url.endsWith('/revoke') ? { status: google.revokeStatus, body: null } : google.token;
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
}

const revokedTokens = () => google.requests
    .filter((request) => request.url === 'https://oauth2.googleapis.com/revoke')
    .map((request) => request.form.token);

/** A callable request from a signed-in user on a site. */
function callFrom({ uid = ADMIN, origin = 'https://app.safehaul.io', data = {} } = {}) {
    return { auth: uid ? { uid } : undefined, data, rawRequest: { headers: origin ? { origin } : {} } };
}

/** The default everything below starts from; called by each suite's `beforeEach`. */
function resetGmailHarness() {
    jest.resetAllMocks();
    process.env.SMS_ENCRYPTION_KEY = ENCRYPTION_KEY;
    mock.reset(seedDocuments());
    google.revokeStatus = 200;
    google.requests.length = 0;
    grantSending();

    require('../../shared/gmail/oauthClient')._resetClientCacheForTesting();
    require('../../shared/rateLimiter').checkRateLimit.mockImplementation(async () => true);
    require('../../shared/companyAccess').assertCompanyAdminStrict.mockImplementation(
        async (_uid, companyId) => mock.db.collection('companies').doc(companyId).get(),
    );
    require('../../shared/secretStore').readLatestSecret.mockImplementation(async (name) => ({
        GMAIL_OAUTH_CLIENT_ID: CLIENT_ID,
        GMAIL_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
    })[name] ?? null);
    jest.spyOn(globalThis, 'fetch').mockImplementation(googleFetch);
    for (const method of ['log', 'warn', 'error']) jest.spyOn(console, method).mockImplementation(() => {});
}

/** A clock (`Date.now`) that `jump(ms)` moves on. `afterEach` restores it. */
function movableClock() {
    const realNow = Date.now.bind(Date);
    let offset = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    return (ms) => { offset += ms; };
}

/** From now on every transaction commits `ms` after its handler ran: the clock moves on by that much. */
function commitLate(ms) {
    const jump = movableClock();
    const run = mock.db.runTransaction;
    jest.spyOn(mock.db, 'runTransaction').mockImplementation(async (handler) => {
        const result = await run(handler);
        jump(ms);
        return result;
    });
}

/** The clock moves on by `ms` once Google's token endpoint answers: a stall after the code exchange. */
function stallAfterExchange(ms) {
    const jump = movableClock();
    globalThis.fetch.mockImplementation(async (url, init) => {
        const answer = await googleFetch(url, init);
        if (url.endsWith('/token')) jump(ms);
        return answer;
    });
}

/** Everything the suite logged, as one string: no token or address may appear in it. */
const loggedText = () => JSON.stringify(['log', 'warn', 'error'].flatMap((method) => console[method].mock.calls));

module.exports = {
    ADMIN,
    CLIENT_ID,
    CLIENT_SECRET,
    EMAIL_CONFIG,
    SEND_SCOPE,
    callFrom,
    commitLate,
    firebaseAdminMock,
    google,
    grantSending,
    httpsMock,
    idTokenFor,
    loggedText,
    mock,
    resetGmailHarness,
    revokedTokens,
    stallAfterExchange,
};
