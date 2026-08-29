/**
 * Secret naming, the credential lifecycle, non-secret settings, and the two
 * Groq legacy paths.
 *
 * Part of the `aiCredentials` suite. The Firestore double, the fake Secret
 * Manager, the fixtures and the reset are in `aiCredentials.support.js`. Each
 * `jest.mock` below has to stay in this file, because Jest hoists it per file
 * and cannot register one from a helper.
 */

jest.mock('firebase-functions/v2/https', () => require('./aiCredentials.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./aiCredentials.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./aiCredentials.support').rateLimiterMock());
jest.mock('../../ai/tasks/healthCheck', () => require('./aiCredentials.support').healthCheckMock());
jest.mock('@google-cloud/secret-manager', () => require('./aiCredentials.support').secretManagerMock());

const secretManager = require('../../ai/credentials/secretManager');
const store = require('../../ai/credentials/store');
const { PROVIDERS } = require('../../ai/registry/providers');
// The mocked module, so this is the very `jest.fn()` the support file owns.
const {
    mockRequestedNames, mockFakeClient, requestOf, resetCredentialState,
} = require('./aiCredentials.support');

beforeEach(resetCredentialState);

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
