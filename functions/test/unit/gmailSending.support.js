/**
 * Shared harness for the suites on sending through a connected Gmail
 * (`shared/gmail/*`, `emailService.js`, `sendTestEmail.js`).
 *
 * `jest.mock` is hoisted per file, so each suite registers its own mocks with
 * the factories below; the in-memory store is built here and reset in place,
 * because the modules under test destructure `{ admin, db }` when they load.
 * Nothing here requires the code under test at load time, so a factory can
 * require this file while that code is still loading.
 *
 * Google is a `fetch` double for the token endpoint and Gmail's upload
 * endpoint: each answers from its queue, else succeeds, and every request is
 * recorded. Every id, address and token is artificial.
 */
const ENCRYPTION_KEY = 'artificial-key-of-32-characters!';
process.env.SMS_ENCRYPTION_KEY = ENCRYPTION_KEY;

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock();

const COMPANY = 'co-1';
const COMPANY_NAME = 'Artificial Freight LLC';
const GMAIL = 'hiring@example.test';
const REFRESH_TOKEN = 'artificial-refresh-token-1001';
const CLIENT_ID = 'artificial-client.apps.googleusercontent.com';
const CLIENT_SECRET = 'artificial-client-secret';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SEND_ENDPOINT = 'https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const EMAIL_CONFIG = (companyId = COMPANY) => `companies/${companyId}/system_settings/email_config`;
const NOTICES = (companyId = COMPANY) => `companies/${companyId}/notifications/`;

const firebaseAdminMock = () => ({ admin: mock.admin, db: mock.db });

const httpsMock = () => ({
    onCall: (_options, handler) => handler,
    HttpsError: class HttpsError extends Error {
        constructor(code, message, details) { super(message); this.code = code; this.details = details; }
    },
});

/**
 * Google's answers, in order: each entry `{ status, body }`, or `'network'`
 * for a request that never gets an answer. An empty queue answers success.
 */
const google = {
    refreshAnswers: [],
    sendAnswers: [],
    requests: [],
    issued: 0,
};

/** A Gmail API error answer, as Google writes one. */
const gmailError = (status, reason) => ({
    status,
    body: { error: { code: status, message: `Artificial Google text naming ${GMAIL}`, errors: [{ reason, message: 'artificial' }] } },
});

async function googleFetch(url, init = {}) {
    google.requests.push({ url, init });
    let answer;
    if (url === TOKEN_ENDPOINT) {
        google.issued += 1;
        answer = google.refreshAnswers.shift()
            || { status: 200, body: { access_token: `artificial-access-${google.issued}`, expires_in: 3599, scope: SEND_SCOPE } };
    } else if (url === SEND_ENDPOINT) {
        answer = google.sendAnswers.shift() || { status: 200, body: { id: '18c0a1b2c3d4e5f6', threadId: '18c0a1b2c3d4e5f6' } };
    } else {
        throw new Error(`Unexpected request to ${url}`);
    }
    if (answer === 'network') throw new TypeError(`fetch failed for ${GMAIL}`);
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
}

const requestsTo = (url) => google.requests.filter((request) => request.url === url);
const uploads = () => requestsTo(SEND_ENDPOINT);
const refreshes = () => requestsTo(TOKEN_ENDPOINT);
/** The raw message of the n-th upload, as Gmail received it. */
const rawUpload = (index = 0) => Buffer.from(uploads()[index].init.body).toString('utf8');

/** The company's `email_config` with SMTP settings kept and Gmail connected. */
function gmailConfig(overrides = {}) {
    const { sealPassword } = require('../../shared/smtpSettings');
    return {
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'ops@example.test',
        smtpPass: sealPassword('artificial-smtp-password'),
        signature: 'Regards, Artificial Freight',
        provider: 'gmail',
        gmailEmail: GMAIL,
        gmailSub: '1001',
        gmailRefreshToken: sealPassword(REFRESH_TOKEN),
        gmailScopes: ['email', 'openid', SEND_SCOPE],
        gmailConnectedAt: 'then',
        gmailConnectedBy: 'admin-0',
        gmailStatus: 'active',
        gmailStatusReason: null,
        gmailStatusAt: 'then',
        ...overrides,
    };
}

const config = (companyId = COMPANY) => mock.docs.get(EMAIL_CONFIG(companyId));
/** Every bell notice the company has, by id. */
const notices = (companyId = COMPANY) => [...mock.docs.keys()]
    .filter((path) => path.startsWith(NOTICES(companyId)))
    .map((path) => path.slice(NOTICES(companyId).length));

/** The default every suite starts from, called by its `beforeEach`. */
function resetGmailSending({ seed } = {}) {
    jest.resetAllMocks();
    process.env.SMS_ENCRYPTION_KEY = ENCRYPTION_KEY;
    require('../../integrations/encryption')._resetEncryptionKeyForTesting();
    mock.reset(seed || {
        [`companies/${COMPANY}`]: { companyName: COMPANY_NAME },
        [EMAIL_CONFIG()]: gmailConfig(),
    });
    google.refreshAnswers.length = 0;
    google.sendAnswers.length = 0;
    google.requests.length = 0;
    google.issued = 0;

    require('../../shared/gmail/oauthClient')._resetClientCacheForTesting();
    require('../../shared/gmail/gmailAccess')._resetAccessTokensForTesting();
    require('../../shared/gmail/gmailStatus')._resetNoticesForTesting();
    require('../../shared/secretStore').readLatestSecret.mockImplementation(async (name) => ({
        GMAIL_OAUTH_CLIENT_ID: CLIENT_ID,
        GMAIL_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
    })[name] ?? null);
    jest.spyOn(globalThis, 'fetch').mockImplementation(googleFetch);
    for (const method of ['log', 'info', 'warn', 'error']) jest.spyOn(console, method).mockImplementation(() => {});
}

/** Everything the suite logged, as one string: no token, address or Google text may appear in it. */
const loggedText = () => JSON.stringify(['log', 'info', 'warn', 'error'].flatMap((method) => console[method].mock.calls)
    .map((args) => args.map((value) => (value instanceof Error ? `${value.message} ${value.stack}` : value))));

/** What no log may carry: the refresh and access tokens, the addresses, Google's message text. */
const SECRETS_AND_ADDRESSES = [REFRESH_TOKEN, 'artificial-access-', GMAIL, 'Artificial Google text', CLIENT_SECRET];

module.exports = {
    CLIENT_SECRET,
    COMPANY,
    COMPANY_NAME,
    EMAIL_CONFIG,
    GMAIL,
    REFRESH_TOKEN,
    SECRETS_AND_ADDRESSES,
    SEND_ENDPOINT,
    TOKEN_ENDPOINT,
    config,
    firebaseAdminMock,
    gmailConfig,
    gmailError,
    google,
    httpsMock,
    loggedText,
    mock,
    notices,
    rawUpload,
    refreshes,
    resetGmailSending,
    uploads,
};
