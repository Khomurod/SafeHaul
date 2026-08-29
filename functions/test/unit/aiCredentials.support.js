/**
 * Shared harness for the `aiCredentials.*` suites.
 *
 * The security properties these suites assert are the reason the AI Integrations
 * console can exist at all: a browser cannot name a secret, a non-super-admin
 * cannot reach any of it, a list response carries no plaintext, and an audit
 * record never contains a value.
 *
 * `jest.mock` is hoisted per file and cannot be registered from here, so each
 * suite keeps its own one-line registration and the factory bodies live below.
 * Every factory returns the **same** object each call, so the doubles a suite
 * imports from here are the ones the code under test is talking to.
 *
 * No suite here queues a `*Once` value (checked before the split), so
 * `resetCredentialState` keeps `clearAllMocks`. If you add a
 * `mockResolvedValueOnce`, switch it to `resetAllMocks` and re-establish the
 * implementations below — `clearAllMocks` does not drain a once-queue.
 */

const mockConfigDocs = new Map();
const mockAuditWrites = [];
const mockSecretStore = new Map();

/** A fake Secret Manager that records exactly which resource names it is asked for. */
const mockRequestedNames = [];
const mockFakeClient = {
    accessSecretVersion: async ({ name }) => {
        mockRequestedNames.push(name);
        const id = name.split('/secrets/')[1].split('/versions/')[0];
        if (!mockSecretStore.has(id)) {
            const error = new Error('NOT_FOUND');
            error.code = 5;
            throw error;
        }
        return [{ payload: { data: Buffer.from(mockSecretStore.get(id), 'utf8') } }];
    },
    createSecret: async ({ secretId }) => {
        if (mockSecretStore.has(secretId)) {
            const error = new Error('ALREADY_EXISTS');
            error.code = 6;
            throw error;
        }
        mockSecretStore.set(secretId, '');
        return [{}];
    },
    addSecretVersion: async ({ parent, payload }) => {
        const id = parent.split('/secrets/')[1];
        mockSecretStore.set(id, payload.data.toString('utf8'));
        return [{}];
    },
    listSecretVersions: async ({ parent }) => {
        const id = parent.split('/secrets/')[1];
        if (!mockSecretStore.has(id)) return [[]];
        return [[{ name: `${parent}/versions/1`, state: 'ENABLED' }]];
    },
    destroySecretVersion: async ({ name }) => {
        const id = name.split('/secrets/')[1].split('/versions/')[0];
        mockSecretStore.delete(id);
        return [{}];
    },
};

// The credentials layer creates its own Secret Manager client when none is
// injected, which is what the callables do in production. Mocking the SDK
// module means these tests exercise that real path without a network or any
// application-default credentials.
// No test in this repository may contact a real provider. The connection test
// is the only network path the credential surface has, so it is stubbed here;
// its own behaviour is covered in aiProviders.test.js.
const mockTestProviderConnection = jest.fn().mockResolvedValue({
    success: true, message: 'Connected.', model: 'test/model', latencyMs: 12,
});

const mockCheckRateLimit = jest.fn().mockResolvedValue(true);

const httpsMock = () => {
    class HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
    return {
        HttpsError,
        onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    };
};

const firebaseAdminMock = () => ({
    admin: {
        firestore: {
            FieldValue: {
                serverTimestamp: () => '__ts__',
                delete: () => '__delete__',
            },
        },
    },
    db: {
        collection: (name) => ({
            doc: (id) => ({
                get: async () => ({
                    exists: mockConfigDocs.has(`${name}/${id}`),
                    data: () => mockConfigDocs.get(`${name}/${id}`),
                }),
                set: async (patch) => {
                    const key = `${name}/${id}`;
                    const current = mockConfigDocs.get(key) || {};
                    const merged = { ...current };
                    for (const [field, value] of Object.entries(patch)) {
                        if (value === '__delete__') delete merged[field];
                        else merged[field] = value;
                    }
                    mockConfigDocs.set(key, merged);
                },
            }),
            get: async () => ({
                forEach: (fn) => {
                    for (const [key, value] of mockConfigDocs.entries()) {
                        if (!key.startsWith(`${name}/`)) continue;
                        fn({ id: key.slice(name.length + 1), data: () => value });
                    }
                },
                docs: [],
            }),
            add: async (row) => { mockAuditWrites.push({ collection: name, row }); },
            orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
        }),
    },
});

/** One object, so a suite's `mockCheckRateLimit` is the one the code calls. */
const rateLimiterMock = () => ({ checkRateLimit: mockCheckRateLimit });

const healthCheckMock = () => ({
    testProviderConnection: (...args) => mockTestProviderConnection(...args),
    HEALTH_PROMPT: 'Reply with the single word: ready',
});

const secretManagerMock = () => ({
    SecretManagerServiceClient: class {
        constructor() { return mockFakeClient; }
    },
});

const SUPER_ADMIN = {
    uid: 'sa1',
    token: { globalRole: 'super_admin', auth_time: Math.floor(Date.now() / 1000) },
};

function requestOf(data, auth = SUPER_ADMIN) {
    return { auth, data };
}

/**
 * `../../ai/credentials/secretManager` is required lazily. This module is loaded
 * from a hoisted `jest.mock` factory, which runs *while* a suite is requiring
 * that module — so a top-level require here would reach it mid-construction.
 *
 * The body below is the original `beforeEach`, with `checkRateLimit` reached
 * through the spy this module owns rather than through the mocked module. Same
 * function either way: `rateLimiterMock` hands the code this very object.
 */
function resetCredentialState() {
    const secretManager = require('../../ai/credentials/secretManager');
    jest.clearAllMocks();
    mockConfigDocs.clear();
    mockAuditWrites.length = 0;
    mockSecretStore.clear();
    mockRequestedNames.length = 0;
    secretManager.clearCache();
    process.env.FIREBASE_PROJECT_ID = 'truckerapp-system';
    mockCheckRateLimit.mockResolvedValue(true);
}

module.exports = {
    httpsMock,
    firebaseAdminMock,
    rateLimiterMock,
    healthCheckMock,
    secretManagerMock,
    mockConfigDocs,
    mockAuditWrites,
    mockSecretStore,
    mockRequestedNames,
    mockFakeClient,
    mockTestProviderConnection,
    mockCheckRateLimit,
    SUPER_ADMIN,
    requestOf,
    resetCredentialState,
};
