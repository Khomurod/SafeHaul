/**
 * AI credential storage and the Super Admin callables that manage it.
 *
 * The security properties asserted here are the reason the AI Integrations
 * console can exist at all: a browser cannot name a secret, a non-super-admin
 * cannot reach any of it, a list response carries no plaintext, and an audit
 * record never contains a value.
 */

jest.mock('firebase-functions/v2/https', () => {
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
});

const mockConfigDocs = new Map();
const mockAuditWrites = [];

jest.mock('../../firebaseAdmin', () => ({
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
}));

jest.mock('../../shared/rateLimiter', () => ({
    checkRateLimit: jest.fn().mockResolvedValue(true),
}));

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
jest.mock('../../ai/tasks/healthCheck', () => ({
    testProviderConnection: (...args) => mockTestProviderConnection(...args),
    HEALTH_PROMPT: 'Reply with the single word: ready',
}));

jest.mock('@google-cloud/secret-manager', () => ({
    SecretManagerServiceClient: class {
        constructor() { return mockFakeClient; }
    },
}));

const secretManager = require('../../ai/credentials/secretManager');
const store = require('../../ai/credentials/store');
const { PROVIDERS } = require('../../ai/registry/providers');
const { checkRateLimit } = require('../../shared/rateLimiter');

const SUPER_ADMIN = {
    uid: 'sa1',
    token: { globalRole: 'super_admin', auth_time: Math.floor(Date.now() / 1000) },
};

function requestOf(data, auth = SUPER_ADMIN) {
    return { auth, data };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockConfigDocs.clear();
    mockAuditWrites.length = 0;
    mockSecretStore.clear();
    mockRequestedNames.length = 0;
    secretManager.clearCache();
    process.env.FIREBASE_PROJECT_ID = 'truckerapp-system';
    checkRateLimit.mockResolvedValue(true);
});

describe('secret naming', () => {
    it('derives a SafeHaul-namespaced name for every provider credential', () => {
        for (const provider of PROVIDERS) {
            for (const field of provider.secretFields) {
                const id = secretManager.buildSecretId(provider.id, field.name);
                expect(id).toMatch(/^SAFEHAUL_AI_[A-Z0-9_]+$/);
            }
        }
        expect(secretManager.buildSecretId('groq', 'apiKey')).toBe('SAFEHAUL_AI_GROQ_APIKEY');
        expect(secretManager.buildSecretId('cloudflare', 'apiToken')).toBe('SAFEHAUL_AI_CLOUDFLARE_APITOKEN');
        expect(secretManager.buildSecretId('github-models', 'token')).toBe('SAFEHAUL_AI_GITHUB_MODELS_TOKEN');
    });

    it('refuses a provider id that is not in the frozen registry', () => {
        expect(() => secretManager.buildSecretId('evil-provider', 'apiKey')).toThrow(/Unknown AI provider/);
        expect(() => secretManager.buildSecretId('../../../etc', 'apiKey')).toThrow(/Unknown AI provider/);
    });

    it('refuses a credential field the provider never declared', () => {
        // Groq declares only `apiKey`; asking for another field is how an
        // attacker would try to reach a different secret.
        expect(() => secretManager.buildSecretId('groq', 'SMS_ENCRYPTION_KEY'))
            .toThrow(/no credential field/);
    });

    it('refuses to touch a resource outside the SafeHaul AI namespace', () => {
        expect(() => secretManager.assertSafehaulAiSecret('SMS_ENCRYPTION_KEY')).toThrow(/outside the SafeHaul AI namespace/);
        expect(() => secretManager.assertSafehaulAiSecret('GROQ_API_KEY')).toThrow(/outside the SafeHaul AI namespace/);
        expect(secretManager.assertSafehaulAiSecret('SAFEHAUL_AI_GROQ_APIKEY')).toBe('SAFEHAUL_AI_GROQ_APIKEY');
    });

    it('only ever asks Secret Manager for a derived SAFEHAUL_AI_ name', async () => {
        await secretManager.readSecret('groq', 'apiKey', { client: mockFakeClient });
        await secretManager.readSecret('mistral', 'apiKey', { client: mockFakeClient });

        expect(mockRequestedNames.length).toBeGreaterThan(0);
        for (const name of mockRequestedNames) {
            expect(name).toMatch(/\/secrets\/SAFEHAUL_AI_[A-Z0-9_]+\/versions\/latest$/);
        }
    });
});

describe('credential lifecycle', () => {
    it('adds, reads back and replaces a credential', async () => {
        await secretManager.writeSecret('mistral', 'apiKey', 'first-value', { client: mockFakeClient });
        expect(await secretManager.readSecret('mistral', 'apiKey', { client: mockFakeClient })).toBe('first-value');

        await secretManager.writeSecret('mistral', 'apiKey', 'second-value', { client: mockFakeClient });
        expect(await secretManager.readSecret('mistral', 'apiKey', { client: mockFakeClient })).toBe('second-value');
    });

    it('destroys versions on delete and reports the provider unconfigured', async () => {
        await secretManager.writeSecret('cerebras', 'apiKey', 'value', { client: mockFakeClient });

        const result = await secretManager.destroySecretVersions('cerebras', 'apiKey', { client: mockFakeClient });

        expect(result.destroyed).toBe(1);
        expect(await secretManager.readSecret('cerebras', 'apiKey', { client: mockFakeClient })).toBeNull();
    });

    it('treats a missing secret as unconfigured rather than an error', async () => {
        await expect(secretManager.readSecret('sambanova', 'apiKey', { client: mockFakeClient }))
            .resolves.toBeNull();
    });
});

describe('non-secret provider settings', () => {
    it('rejects a setting the provider never declared', async () => {
        await expect(store.writeConfig('cloudflare', { somethingElse: 'x' }))
            .rejects.toThrow(/not a configurable setting/);
    });

    it('rejects a malformed Cloudflare account id before it can reach a URL', async () => {
        await expect(store.writeConfig('cloudflare', { accountId: '../../evil' }))
            .rejects.toThrow(/not in the expected format/);
    });

    it('accepts a well-formed account id', async () => {
        const config = await store.writeConfig('cloudflare', { accountId: 'a'.repeat(32) });
        expect(config.accountId).toBe('a'.repeat(32));
    });

    it('treats an absent config document as enabled', async () => {
        expect((await store.readConfig('groq')).enabled).toBe(true);
    });
});

describe('legacy Groq fallback', () => {
    const original = process.env.GROQ_API_KEY;
    afterAll(() => {
        if (original === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = original;
    });

    it('uses the legacy binding when no managed credential exists', async () => {
        process.env.GROQ_API_KEY = 'legacy-key';

        const resolved = await store.resolveCredentials('groq', { client: mockFakeClient });

        expect(resolved.complete).toBe(true);
        expect(resolved.values.apiKey).toBe('legacy-key');
        expect(resolved.source).toBe('legacy-env');
    });

    it('prefers the managed credential once one exists', async () => {
        process.env.GROQ_API_KEY = 'legacy-key';
        await secretManager.writeSecret('groq', 'apiKey', 'managed-key', { client: mockFakeClient });

        const resolved = await store.resolveCredentials('groq', { client: mockFakeClient });

        expect(resolved.values.apiKey).toBe('managed-key');
        expect(resolved.source).toBe('secret-manager');
    });

    it('does not extend the fallback to any other provider', async () => {
        process.env.GROQ_API_KEY = 'legacy-key';

        const resolved = await store.resolveCredentials('gemini', { client: mockFakeClient });

        expect(resolved.complete).toBe(false);
        expect(resolved.source).toBeNull();
    });
});

/**
 * A credential that cannot be READ is a different fact from one that is absent,
 * and conflating them is what produced the reported symptom: "CDL scanning fails
 * with Not configured even though providers and credentials exist."
 *
 * `readSecret` returns null only for NOT_FOUND and re-throws everything else, so
 * `PERMISSION_DENIED` — a runtime service account without
 * `roles/secretmanager.secretAccessor` — is the case these tests pin.
 */
describe('an unreadable credential is not an absent one', () => {
    const original = process.env.GROQ_API_KEY;

    /** A Secret Manager that exists, holds the secret, and refuses to serve it. */
    const denyingClient = {
        accessSecretVersion: async () => {
            const error = new Error('7 PERMISSION_DENIED: Permission denied on resource');
            error.code = 7;
            throw error;
        },
    };

    beforeEach(() => {
        // Reads are cached for 60 seconds; an earlier test's success would
        // otherwise answer before the denying client is ever consulted.
        secretManager.clearCache();
    });

    afterAll(() => {
        secretManager.clearCache();
        if (original === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = original;
    });

    it('reports the field as unreadable rather than missing', async () => {
        const read = await store.readCredentials('gemini', { client: denyingClient });

        expect(read.complete).toBe(false);
        expect(read.unreadable).toEqual(['apiKey']);
        // The distinction the console depends on: nothing is *missing*, so
        // telling an operator to add a key would be wrong.
        expect(read.missing).toEqual([]);
    });

    it('does not throw, so the router can still try the next provider', async () => {
        await expect(store.readCredentials('gemini', { client: denyingClient }))
            .resolves.toMatchObject({ complete: false });
    });

    /**
     * The defect this whole stage exists for. The Groq fallback triggered on
     * `missing` alone, and a refused read throws before a field is ever recorded
     * as missing — so the deploy binding sat there, working, and was never
     * consulted. A rollback path that only survives the rarer of two faults is
     * not a rollback path.
     */
    it('falls back to the legacy Groq binding when the managed read is refused', async () => {
        process.env.GROQ_API_KEY = 'legacy-key';

        const resolved = await store.resolveCredentials('groq', { client: denyingClient });

        expect(resolved.complete).toBe(true);
        expect(resolved.values.apiKey).toBe('legacy-key');
        // Distinguished from a plain `legacy-env` so the console can say this is
        // a fault being masked, not a migration state to leave alone.
        expect(resolved.source).toBe('legacy-env-after-read-failure');
    });

    it('still refuses to extend that fallback to another provider', async () => {
        process.env.GROQ_API_KEY = 'legacy-key';

        const resolved = await store.resolveCredentials('mistral', { client: denyingClient });

        expect(resolved.complete).toBe(false);
        expect(resolved.source).toBeNull();
        expect(resolved.unreadable).toEqual(['apiKey']);
    });

    it('lets an operator still reveal the legacy value when the managed read fails', async () => {
        process.env.GROQ_API_KEY = 'legacy-key';

        const revealed = await store.revealCredential('groq', 'apiKey', { client: denyingClient });

        expect(revealed.value).toBe('legacy-key');
        expect(revealed.source).toBe('legacy-env-after-read-failure');
    });

    it('never puts the Secret Manager resource name in what it returns', async () => {
        const read = await store.readCredentials('gemini', { client: denyingClient });

        expect(JSON.stringify(read)).not.toMatch(/PERMISSION_DENIED/);
        expect(JSON.stringify(read)).not.toMatch(/projects\//);
    });
});

/**
 * A flat 30-minute quota cooldown is the right answer for a spent daily
 * allowance and badly the wrong one for a per-minute cap. Measured live: the
 * Gemini free tier allows 20 requests per minute and its 429 body says "Please
 * retry in 44.26781542s" — so resting it for half an hour removed the
 * highest-priority provider from every lane for forty times longer than the
 * vendor asked.
 */
describe('quota cooldown sizing', () => {
    it('rests for the vendor stated wait plus a small buffer', () => {
        expect(store.quotaCooldownMs(44268)).toBe(44268 + store.QUOTA_COOLDOWN_BUFFER_MS);
    });

    it('keeps the flat window when the vendor stated nothing', () => {
        expect(store.quotaCooldownMs(null)).toBe(store.QUOTA_COOLDOWN_MS);
        expect(store.quotaCooldownMs(undefined)).toBe(store.QUOTA_COOLDOWN_MS);
        expect(store.quotaCooldownMs(0)).toBe(store.QUOTA_COOLDOWN_MS);
    });

    it('never rests longer than the flat window, however long the vendor claims', () => {
        expect(store.quotaCooldownMs(6 * 60 * 60 * 1000)).toBe(store.QUOTA_COOLDOWN_MS);
    });

    it('never rests for an unusably short moment', () => {
        expect(store.quotaCooldownMs(1)).toBe(store.QUOTA_COOLDOWN_FLOOR_MS);
    });
});

describe('cooldown', () => {
    it('reports no cooldown for a healthy provider', () => {
        expect(store.cooldownState({}).active).toBe(false);
    });

    it('reports an active cooldown until it expires', () => {
        const future = { cooldownUntil: Date.now() + 60000, cooldownReason: 'quota' };
        expect(store.cooldownState(future)).toMatchObject({ active: true, reason: 'quota' });

        const past = { cooldownUntil: Date.now() - 1, cooldownReason: 'quota' };
        expect(store.cooldownState(past).active).toBe(false);
    });

    it('gives an exhausted quota a longer rest than an ordinary failure', () => {
        expect(store.QUOTA_COOLDOWN_MS).toBeGreaterThan(store.FAILURE_COOLDOWN_MS);
    });
});

/**
 * A provider's text lane and its image lane reach different models, in different
 * request shapes, on different vendor entitlements. They fail independently, and
 * one health scalar could describe neither:
 *
 *  - any success set `health: 'healthy'`, so blog articles generating normally
 *    kept resetting the badge while every CDL photograph was being rejected;
 *  - the failure counter was shared, so three rejected images cooled the provider
 *    out of the *text* lane too.
 */
describe('health and cooldown are tracked per lane', () => {
    async function fail(providerId, lane, category = 'provider_request_rejected') {
        await store.recordProviderOutcome(providerId, { success: false, lane, category });
    }

    it('does not let a text success hide a broken vision lane', async () => {
        await fail('gemini', 'vision');
        await store.recordProviderOutcome('gemini', { success: true, lane: 'text' });

        const config = await store.readConfig('gemini');

        expect(config.laneHealth).toMatchObject({ vision: 'degraded', text: 'healthy' });
        // The summary scalar reports the worst lane, so the console cannot show
        // a green badge for a provider with a broken capability.
        expect(config.health).toBe('degraded');
    });

    it('counts failures per lane rather than in one shared tally', async () => {
        await fail('mistral', 'vision');
        await fail('mistral', 'vision');
        await fail('mistral', 'text');

        const config = await store.readConfig('mistral');

        expect(config.laneFailures).toMatchObject({ vision: 2, text: 1 });
    });

    it('cools only the failing lane, leaving the working one routable', async () => {
        await fail('groq', 'vision');
        await fail('groq', 'vision');
        await fail('groq', 'vision');

        const config = await store.readConfig('groq');

        expect(store.cooldownState(config, Date.now(), 'vision').active).toBe(true);
        // The whole point: three rejected images must not stop this provider
        // writing an article.
        expect(store.cooldownState(config, Date.now(), 'text').active).toBe(false);
        // With no lane the console still sees that something is resting.
        expect(store.cooldownState(config, Date.now()).active).toBe(true);
    });

    it('keeps a quota cooldown provider-wide, because an allowance is not per lane', async () => {
        await store.recordProviderOutcome('cerebras', {
            success: false, lane: 'text', category: 'rate_limited',
        });

        const config = await store.readConfig('cerebras');

        expect(store.cooldownState(config, Date.now(), 'text').active).toBe(true);
        expect(store.cooldownState(config, Date.now(), 'vision').active).toBe(true);
        expect(config.laneHealth.text).toBe('quota');
    });

    it('clears every lane when an operator clears the cooldown', async () => {
        await fail('sambanova', 'vision');
        await fail('sambanova', 'vision');
        await fail('sambanova', 'vision');
        await store.clearCooldown('sambanova');

        const config = await store.readConfig('sambanova');

        expect(store.cooldownState(config, Date.now()).active).toBe(false);
    });

    it('reports the worst lane, and unknown when nothing has been recorded', () => {
        expect(store.worstLaneHealth({ text: 'healthy', vision: 'quota' })).toBe('quota');
        expect(store.worstLaneHealth({ text: 'healthy', vision: 'degraded' })).toBe('degraded');
        expect(store.worstLaneHealth({ text: 'healthy' })).toBe('healthy');
        expect(store.worstLaneHealth({})).toBe('unknown');
        expect(store.worstLaneHealth(undefined)).toBe('unknown');
    });
});

describe('Super Admin callables', () => {
    const callables = require('../../ai/callables');

    const deniedIdentities = [
        ['an unauthenticated caller', null],
        ['an ordinary user', { uid: 'u1', token: { auth_time: Math.floor(Date.now() / 1000) } }],
        ['a company admin', {
            uid: 'u2',
            token: { roles: { 'company-1': 'company_admin' }, auth_time: Math.floor(Date.now() / 1000) },
        }],
        ['a company admin whose claim is nested', {
            uid: 'u3',
            token: { roles: { globalRole: 'company_admin' }, auth_time: Math.floor(Date.now() / 1000) },
        }],
    ];

    it.each(deniedIdentities)('denies %s on list', async (_label, auth) => {
        await expect(callables.listAiProviders(requestOf({}, auth))).rejects.toMatchObject({
            code: expect.stringMatching(/unauthenticated|permission-denied/),
        });
    });

    it.each(deniedIdentities)('denies %s on the credential access check', async (_label, auth) => {
        await expect(callables.diagnoseAiCredentialAccess(requestOf({}, auth))).rejects.toMatchObject({
            code: expect.stringMatching(/unauthenticated|permission-denied/),
        });
    });

    it('reports credential access to a super admin without revealing a value', async () => {
        await secretManager.writeSecret('gemini', 'apiKey', 'gemini-plaintext', { client: mockFakeClient });

        const report = await callables.diagnoseAiCredentialAccess(requestOf({}));

        expect(report.generation).toBe('v2');
        expect(JSON.stringify(report)).not.toContain('gemini-plaintext');
        // A read is not a reveal, so it takes the list budget rather than the
        // mutate one — but it is still audited, value-free.
        expect(JSON.stringify(mockAuditWrites)).toContain('AI credential access');
    });

    it.each(deniedIdentities)('denies %s on reveal', async (_label, auth) => {
        await expect(callables.revealAiCredential(
            requestOf({ providerId: 'groq', field: 'apiKey' }, auth),
        )).rejects.toMatchObject({
            code: expect.stringMatching(/unauthenticated|permission-denied/),
        });
    });

    it('allows an exact super admin whose claim is nested under roles', async () => {
        const nested = {
            uid: 'sa2',
            token: { roles: { globalRole: 'super_admin' }, auth_time: Math.floor(Date.now() / 1000) },
        };
        await expect(callables.listAiProviders(requestOf({}, nested))).resolves.toBeTruthy();
    });

    it('requires recent authentication to reveal', async () => {
        const stale = {
            uid: 'sa1',
            token: { globalRole: 'super_admin', auth_time: Math.floor(Date.now() / 1000) - (16 * 60) },
        };

        await expect(callables.revealAiCredential(
            requestOf({ providerId: 'groq', field: 'apiKey' }, stale),
        )).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('requires recent authentication to mutate', async () => {
        const stale = {
            uid: 'sa1',
            token: { globalRole: 'super_admin', auth_time: Math.floor(Date.now() / 1000) - (16 * 60) },
        };

        await expect(callables.saveAiCredential(
            requestOf({ providerId: 'mistral', field: 'apiKey', value: 'v' }, stale),
        )).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('does not require recent authentication merely to list', async () => {
        const stale = {
            uid: 'sa1',
            token: { globalRole: 'super_admin', auth_time: Math.floor(Date.now() / 1000) - (16 * 60) },
        };
        await expect(callables.listAiProviders(requestOf({}, stale))).resolves.toBeTruthy();
    });

    it('rate-limits reveals and fails closed', async () => {
        checkRateLimit.mockResolvedValue(false);

        await expect(callables.revealAiCredential(
            requestOf({ providerId: 'groq', field: 'apiKey' }),
        )).rejects.toMatchObject({ code: 'resource-exhausted' });
    });

    it('lists all nine providers with no plaintext anywhere in the response', async () => {
        await secretManager.writeSecret('mistral', 'apiKey', 'super-secret-mistral-key', { client: mockFakeClient });

        const response = await callables.listAiProviders(requestOf({}));
        const serialized = JSON.stringify(response);

        expect(response.providers).toHaveLength(9);
        expect(serialized).not.toContain('super-secret-mistral-key');
        // Every credential field renders as the fixed mask, which reveals
        // nothing — not even the real length.
        for (const provider of response.providers) {
            for (const field of provider.credentialFields) {
                expect(field.maskedValue).toBe('********');
                expect(field).not.toHaveProperty('value');
            }
        }
    });

    it('reports the retired provider honestly instead of hiding it', async () => {
        const response = await callables.listAiProviders(requestOf({}));
        const github = response.providers.find((row) => row.id === 'github-models');

        expect(github.retired).toBeTruthy();
        expect(github.enabled).toBe(false);
        expect(github.health).toBe('retired');
        expect(github.retired.reason).toMatch(/retired GitHub Models/i);
    });

    it('preserves the documented priority order in the list', async () => {
        const response = await callables.listAiProviders(requestOf({}));
        // Gemini leads; see the priority note in the registry. The console must
        // show the real routing order, not the order the brief first specified.
        expect(response.providers.map((row) => row.id)).toEqual([
            'gemini', 'groq', 'cloudflare', 'github-models',
            'mistral', 'cerebras', 'sambanova', 'openrouter', 'huggingface',
        ]);
    });

    it('reveals exactly one credential per request', async () => {
        await secretManager.writeSecret('mistral', 'apiKey', 'mistral-value', { client: mockFakeClient });
        await secretManager.writeSecret('cerebras', 'apiKey', 'cerebras-value', { client: mockFakeClient });

        const response = await callables.revealAiCredential(
            requestOf({ providerId: 'mistral', field: 'apiKey' }),
        );

        expect(response.value).toBe('mistral-value');
        expect(JSON.stringify(response)).not.toContain('cerebras-value');
    });

    it('rejects a provider id that is not registered', async () => {
        await expect(callables.revealAiCredential(
            requestOf({ providerId: 'evil', field: 'apiKey' }),
        )).rejects.toMatchObject({ code: 'not-found' });
    });

    it('rejects an unregistered credential field', async () => {
        await expect(callables.revealAiCredential(
            requestOf({ providerId: 'groq', field: 'SMS_ENCRYPTION_KEY' }),
        )).rejects.toMatchObject({ code: 'not-found' });
    });

    it('refuses to configure the retired provider', async () => {
        await expect(callables.saveAiCredential(
            requestOf({ providerId: 'github-models', field: 'token', value: 'ghp_x' }),
        )).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('writes a value-free audit record for every reveal', async () => {
        await secretManager.writeSecret('mistral', 'apiKey', 'mistral-value', { client: mockFakeClient });
        mockAuditWrites.length = 0;

        await callables.revealAiCredential(requestOf({ providerId: 'mistral', field: 'apiKey' }));

        const reveals = mockAuditWrites.filter((entry) => entry.row.action === 'reveal');
        expect(reveals).toHaveLength(1);
        const serialized = JSON.stringify(reveals[0]);
        expect(serialized).not.toContain('mistral-value');
        // Length is the only fact about the value that may be recorded.
        expect(reveals[0].row.valueLength).toBe('mistral-value'.length);
    });

    it('writes a value-free audit record for every save', async () => {
        await callables.saveAiCredential(
            requestOf({ providerId: 'cerebras', field: 'apiKey', value: 'csk-secret-value' }),
        );

        const serialized = JSON.stringify(mockAuditWrites);
        expect(serialized).not.toContain('csk-secret-value');
        expect(serialized).toContain('SAFEHAUL_AI_CEREBRAS_APIKEY');
    });

    /**
     * Writing a secret and reading one need different IAM permissions, and
     * creating a secret grants nobody access to it. So this console could create
     * a credential it was then unable to use, report "saved", and leave the
     * provider skipped as unconfigured on every subsequent request — with the
     * operator reasonably certain they had just fixed it.
     */
    it('confirms a saved credential can be read back', async () => {
        const result = await callables.saveAiCredential(
            requestOf({ providerId: 'cerebras', field: 'apiKey', value: 'csk-secret-value' }),
        );

        expect(result).toMatchObject({ saved: true, readable: true, message: null });
    });

    it('says what to grant when a saved credential cannot be read back', async () => {
        // The write succeeds and the read-back is refused, which is exactly the
        // shape of a secret created by a principal that may create but not read.
        const spy = jest.spyOn(store, 'readCredentials').mockResolvedValue({
            complete: false, values: {}, missing: [], unreadable: ['apiKey'],
        });
        try {
            const result = await callables.saveAiCredential(
                requestOf({ providerId: 'sambanova', field: 'apiKey', value: 'sn-secret-value' }),
            );

            expect(result.saved).toBe(true);
            expect(result.readable).toBe(false);
            expect(result.message).toMatch(/secretmanager\.secretAccessor/);
            // It also has to say that the two Functions generations use
            // different accounts, or half the grants will be made to the wrong one.
            expect(result.message).toMatch(/1st and 2nd generation/i);
            // Never the value, even in the sentence that explains the problem.
            expect(JSON.stringify(result)).not.toContain('sn-secret-value');
        } finally {
            spy.mockRestore();
        }
    });

    it('requires a typed confirmation to delete', async () => {
        await secretManager.writeSecret('mistral', 'apiKey', 'v', { client: mockFakeClient });

        await expect(callables.deleteAiCredential(
            requestOf({ providerId: 'mistral', field: 'apiKey', confirmation: 'wrong' }),
        )).rejects.toMatchObject({ code: 'failed-precondition' });

        await expect(callables.deleteAiCredential(
            requestOf({ providerId: 'mistral', field: 'apiKey', confirmation: 'Mistral' }),
        )).resolves.toMatchObject({ deleted: true });
    });

    it('marks a provider unconfigured after deletion', async () => {
        await secretManager.writeSecret('mistral', 'apiKey', 'v', { client: mockFakeClient });
        await callables.deleteAiCredential(
            requestOf({ providerId: 'mistral', field: 'apiKey', confirmation: 'Mistral' }),
        );

        const response = await callables.listAiProviders(requestOf({}));
        const mistral = response.providers.find((row) => row.id === 'mistral');
        expect(mistral.configured).toBe(false);
        expect(mistral.enabled).toBe(false);
    });

    it('enables and disables a provider', async () => {
        await callables.setAiProviderEnabled(requestOf({ providerId: 'gemini', enabled: false }));
        let response = await callables.listAiProviders(requestOf({}));
        expect(response.providers.find((row) => row.id === 'gemini').enabled).toBe(false);

        await callables.setAiProviderEnabled(requestOf({ providerId: 'gemini', enabled: true }));
        response = await callables.listAiProviders(requestOf({}));
        expect(response.providers.find((row) => row.id === 'gemini').enabled).toBe(true);
    });

    it('rejects an undeclared setting through the config callable', async () => {
        await expect(callables.updateAiProviderConfig(
            requestOf({ providerId: 'groq', settings: { apiKey: 'sneaky' } }),
        )).rejects.toMatchObject({ code: 'invalid-argument' });
    });
});

describe('Groq migration', () => {
    const callables = require('../../ai/callables');
    const original = process.env.GROQ_API_KEY;

    afterAll(() => {
        if (original === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = original;
    });

    it('refuses when there is no legacy binding to migrate', async () => {
        delete process.env.GROQ_API_KEY;

        await expect(callables.migrateGroqCredential(requestOf({})))
            .rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('never returns the token to the browser', async () => {
        process.env.GROQ_API_KEY = 'gsk-legacy-production-value';

        const response = await callables.migrateGroqCredential(requestOf({}));

        expect(JSON.stringify(response)).not.toContain('gsk-legacy-production-value');
        expect(response.migrated).toBe(true);
    });

    it('leaves the legacy binding in place as a rollback path', async () => {
        process.env.GROQ_API_KEY = 'gsk-legacy-production-value';

        await callables.migrateGroqCredential(requestOf({}));

        // The migration must not remove the old binding in the same
        // unverified step; rollback depends on it still being readable.
        expect(process.env.GROQ_API_KEY).toBe('gsk-legacy-production-value');
    });

    it('is idempotent once a managed credential exists', async () => {
        process.env.GROQ_API_KEY = 'gsk-legacy-production-value';
        await secretManager.writeSecret('groq', 'apiKey', 'already-managed', { client: mockFakeClient });

        const response = await callables.migrateGroqCredential(requestOf({}));

        expect(response.migrated).toBe(false);
        expect(response.alreadyManaged).toBe(true);
    });
});
