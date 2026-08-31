/**
 * Shared harness for the `environmentVault.callables.*` suites.
 *
 * `jest.mock` is hoisted per file and cannot be registered from here, so each
 * suite keeps its own one-line registration and the factory bodies live below.
 * `firebaseAdminMock()` closes over one `createFirestoreMock()` store built at
 * this module's scope, for the reason the original recorded: **the vault modules
 * destructure `{ admin, db }` at require time, so the store has to exist before
 * the first require and then be reset in place.**
 *
 * On the `*Once` hazard: one test queues a `mockRejectedValueOnce` on
 * `factory.getAdapter`, and the original `beforeEach` cleared no mocks at all —
 * it re-seeds the store and installs console spies, which `afterEach` restores.
 * That is preserved exactly rather than "improved", because changing it is a
 * behaviour question and not a size one. **The split makes it strictly safer:**
 * that queue now lives in its own file with its own module registry, so it
 * cannot reach a different subject's tests at all.
 */


// Real encryption, so the decryption path is genuinely exercised.
const ENCRYPTION_KEY = '01234567890123456789012345678901'; // exactly 32 chars
process.env.SMS_ENCRYPTION_KEY = ENCRYPTION_KEY;
const { encrypt } = require('../../integrations/encryption');

const CLIENT_ID_PLAINTEXT = 'artificial-client-id';
const CLIENT_SECRET_PLAINTEXT = 'artificial-client-secret';
const LINE_JWT_PLAINTEXT = 'artificial-line-jwt';
const SMTP_PASSWORD_PLAINTEXT = 'artificial-smtp-password';
const PAGE_TOKEN_PLAINTEXT = 'artificial-page-token';
const GROQ_KEY_PLAINTEXT = 'artificial-groq-key';

function seedDocuments() {
    return {
        'companies/co-alpha': { companyName: 'Alpha Test Carrier' },
        'companies/co-alpha/integrations/sms_provider': {
            provider: 'ringcentral',
            config: {
                clientId: encrypt(CLIENT_ID_PLAINTEXT),
                clientSecret: encrypt(CLIENT_SECRET_PLAINTEXT),
                isSandbox: false,
            },
            defaultPhoneNumber: '+15550001111',
            updatedBy: 'seed-user',
        },
        'companies/co-alpha/integrations/sms_provider/keychain/+15550001111': {
            phoneNumber: '+15550001111',
            label: 'Line A',
            jwt: encrypt(LINE_JWT_PLAINTEXT),
            addedBy: 'seed-user',
        },
        'companies/co-alpha/system_settings/email_config': {
            smtpHost: 'smtp.example.test',
            smtpPort: 587,
            smtpUser: 'ops@example.test',
            smtpPass: SMTP_PASSWORD_PLAINTEXT,
            isVerified: true,
        },
        'integrations_index/page-artificial': {
            platform: 'facebook',
            companyId: 'co-alpha',
            pageId: 'page-artificial',
            pageName: 'Alpha Test Page',
            accessToken: PAGE_TOKEN_PLAINTEXT,
        },
    };
}

// The vault modules destructure `{ admin, db }` at require time, so the store
// has to exist before the first require and then be reset *in place*.
const { createFirestoreMock } = require('../helpers/firestoreMock');
const mock = createFirestoreMock();

const httpsMock = () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
});

const firebaseAdminMock = () => ({
    admin: mock.admin,
    db: mock.db,
    auth: mock.admin.auth(),
    storage: {},
});

const ringcentralSdkMock = () => ({ SDK: class {} });
const integrationFactoryMock = () => ({ getAdapter: jest.fn() });
const emptyAdapterMock = () => class {};

const nowSeconds = () => Math.floor(Date.now() / 1000);

const superAdmin = (overrides = {}) => ({
    uid: 'super-1',
    token: { globalRole: 'super_admin', email: 'ops@example.test', auth_time: nowSeconds(), ...overrides },
});

const request = (auth, data = {}) => ({ auth, data });

/** Every audit document currently in the store. */
const auditRecords = () => {
    const { AUDIT_COLLECTION } = require('../../environmentVault/audit');
    return [...mock.docs.entries()]
        .filter(([path]) => path.startsWith(`${AUDIT_COLLECTION}/`))
        .map(([, data]) => data);
};

/** The original `beforeEach` body, unchanged. */
function resetVaultState() {
    process.env.SMS_ENCRYPTION_KEY = ENCRYPTION_KEY;
    mock.reset(seedDocuments());
    process.env.GROQ_API_KEY = GROQ_KEY_PLAINTEXT;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
}

/** The original `afterEach` body, unchanged. */
function restoreVaultState() {
    delete process.env.GROQ_API_KEY;
    jest.restoreAllMocks();
}

module.exports = {
    httpsMock,
    firebaseAdminMock,
    ringcentralSdkMock,
    integrationFactoryMock,
    emptyAdapterMock,
    mock,
    seedDocuments,
    nowSeconds,
    superAdmin,
    request,
    auditRecords,
    resetVaultState,
    restoreVaultState,
    ENCRYPTION_KEY,
    CLIENT_ID_PLAINTEXT,
    CLIENT_SECRET_PLAINTEXT,
    LINE_JWT_PLAINTEXT,
    SMTP_PASSWORD_PLAINTEXT,
    PAGE_TOKEN_PLAINTEXT,
    GROQ_KEY_PLAINTEXT,
};
