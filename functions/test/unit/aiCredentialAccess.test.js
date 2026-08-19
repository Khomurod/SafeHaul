/**
 * Credential-access diagnosis.
 *
 * This is the check that answers a question no fixture can: whether the runtime
 * can actually read the AI credentials, and as which identity. It exists because
 * two facts combine badly — AI credentials are read at runtime so nothing grants
 * access automatically, and 1st and 2nd generation functions default to
 * different service accounts — which is why a Secret Manager grant can fix some
 * AI entry points and not others.
 *
 * Everything here is a negative as much as a positive: the report must be useful
 * enough to act on and must never carry a credential value.
 */

const mockSecretStore = new Map();

/** Serves what it holds, NOT_FOUND for what it does not. */
const readableClient = {
    accessSecretVersion: async ({ name }) => {
        const id = name.split('/secrets/')[1].split('/versions/')[0];
        if (!mockSecretStore.has(id)) {
            const error = new Error('NOT_FOUND');
            error.code = 5;
            throw error;
        }
        return [{ payload: { data: Buffer.from(mockSecretStore.get(id), 'utf8') } }];
    },
};

/** A Secret Manager that holds everything and refuses to serve any of it. */
const denyingClient = {
    accessSecretVersion: async ({ name }) => {
        const error = new Error(`7 PERMISSION_DENIED: Permission denied on resource ${name}`);
        error.code = 7;
        throw error;
    },
};

jest.mock('@google-cloud/secret-manager', () => ({
    SecretManagerServiceClient: class {
        constructor() { return readableClient; }
    },
}));

const { diagnoseCredentialAccess, METADATA_URL, __test } = require('../../ai/tasks/credentialAccess');
const { clearCache } = require('../../ai/credentials/secretManager');
const { PROVIDERS } = require('../../ai/registry/providers');

// Secret names are project-qualified, and `projectId()` throws without this —
// the Functions runtime always injects it.
process.env.FIREBASE_PROJECT_ID = 'truckerapp-system';

const RUNTIME_EMAIL = 'truckerapp-system@appspot.gserviceaccount.com';

function metadataServing(email) {
    return async (url, options) => {
        expect(url).toBe(METADATA_URL);
        // Without this header the metadata server refuses, so getting it wrong
        // would report "unreachable" on a perfectly reachable server.
        expect(options.headers['Metadata-Flavor']).toBe('Google');
        return { ok: true, text: async () => `${email}\n` };
    };
}

const metadataAbsent = async () => { throw new Error('ENOTFOUND metadata.google.internal'); };

const originalGroqBinding = process.env.GROQ_API_KEY;

beforeEach(() => {
    clearCache();
    mockSecretStore.clear();
    delete process.env.GROQ_API_KEY;
});

afterAll(() => {
    clearCache();
    if (originalGroqBinding === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqBinding;
});

describe('what the report says when everything is readable', () => {
    it('reports a readable credential as present, and an absent one as absent', async () => {
        mockSecretStore.set('SAFEHAUL_AI_GEMINI_APIKEY', 'a-real-key-value');

        const report = await diagnoseCredentialAccess({
            client: readableClient,
            fetchImpl: metadataServing(RUNTIME_EMAIL),
        });
        const byId = Object.fromEntries(report.providers.map((row) => [row.providerId, row]));

        expect(byId.gemini.secrets[0]).toMatchObject({
            field: 'apiKey',
            secretId: 'SAFEHAUL_AI_GEMINI_APIKEY',
            exists: true,
            readable: true,
            reason: null,
        });
        expect(byId.mistral.secrets[0]).toMatchObject({ exists: false, readable: true });
        expect(report.unreadableCount).toBe(0);
        expect(report.summary).toMatch(/readable by this runtime/i);
    });

    it('names the runtime service account rather than assuming it', async () => {
        const report = await diagnoseCredentialAccess({
            client: readableClient,
            fetchImpl: metadataServing(RUNTIME_EMAIL),
        });

        expect(report.runtime).toEqual({ serviceAccount: RUNTIME_EMAIL, source: 'metadata' });
    });

    it('says the metadata server was unreachable rather than inventing an identity', async () => {
        const report = await diagnoseCredentialAccess({
            client: readableClient,
            fetchImpl: metadataAbsent,
        });

        expect(report.runtime).toEqual({ serviceAccount: null, source: 'metadata_unreachable' });
    });

    it('refuses a metadata response that is not an email address', async () => {
        const report = await diagnoseCredentialAccess({
            client: readableClient,
            fetchImpl: async () => ({ ok: true, text: async () => '<html>proxy error</html>' }),
        });

        expect(report.runtime).toEqual({ serviceAccount: null, source: 'metadata_unexpected' });
    });
});

describe('what the report says when a read is refused', () => {
    it('reports permission_denied and refuses to guess whether the secret exists', async () => {
        const report = await diagnoseCredentialAccess({
            client: denyingClient,
            fetchImpl: metadataServing(RUNTIME_EMAIL),
        });
        const gemini = report.providers.find((row) => row.providerId === 'gemini');

        expect(gemini.secrets[0]).toMatchObject({
            readable: false,
            reason: 'permission_denied',
            // Unknown, not absent. A refused read says nothing about whether the
            // credential is there, and guessing "absent" is the original defect
            // this diagnosis exists to correct.
            exists: null,
        });
        expect(report.permissionDeniedCount).toBeGreaterThan(0);
    });

    it('tells the operator which account to grant, and that generations differ', async () => {
        const report = await diagnoseCredentialAccess({
            client: denyingClient,
            fetchImpl: metadataServing(RUNTIME_EMAIL),
        });

        expect(report.summary).toContain(RUNTIME_EMAIL);
        expect(report.summary).toMatch(/secretmanager\.secretAccessor/);
        expect(report.summary).toMatch(/1st and 2nd generation/i);
    });

    it('distinguishes a transient fault from a permission one', async () => {
        const unavailable = {
            accessSecretVersion: async () => {
                const error = new Error('14 UNAVAILABLE');
                error.code = 14;
                throw error;
            },
        };

        const report = await diagnoseCredentialAccess({
            client: unavailable,
            fetchImpl: metadataAbsent,
        });

        expect(report.providers.find((row) => row.providerId === 'gemini').secrets[0].reason)
            .toBe('unavailable');
        expect(report.permissionDeniedCount).toBe(0);
        expect(report.unreadableCount).toBeGreaterThan(0);
    });
});

describe('the report never carries a credential', () => {
    it('contains neither the value nor its length', async () => {
        const secret = 'gsk_ThisMustNeverAppearAnywhereInTheReport';
        mockSecretStore.set('SAFEHAUL_AI_GROQ_APIKEY', secret);
        process.env.GROQ_API_KEY = 'legacy-value-also-never-shown';

        const serialized = JSON.stringify(await diagnoseCredentialAccess({
            client: readableClient,
            fetchImpl: metadataServing(RUNTIME_EMAIL),
        }));

        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain('legacy-value-also-never-shown');
        expect(serialized).not.toContain(String(secret.length));
    });

    it('does not echo the Secret Manager error message', async () => {
        const serialized = JSON.stringify(await diagnoseCredentialAccess({
            client: denyingClient,
            fetchImpl: metadataAbsent,
        }));

        expect(serialized).not.toMatch(/PERMISSION_DENIED/);
        expect(serialized).not.toMatch(/projects\//);
    });
});

describe('report shape', () => {
    it('echoes which Functions generation answered, because that is the diagnosis', async () => {
        const gen1 = await diagnoseCredentialAccess({
            generation: 'v1', client: readableClient, fetchImpl: metadataAbsent,
        });
        const gen2 = await diagnoseCredentialAccess({
            generation: 'v2', client: readableClient, fetchImpl: metadataAbsent,
        });

        expect(gen1.generation).toBe('v1');
        expect(gen2.generation).toBe('v2');
    });

    it('covers every registered provider and asks for no secret twice', async () => {
        const report = await diagnoseCredentialAccess({
            client: readableClient, fetchImpl: metadataAbsent,
        });

        expect(report.providers.map((row) => row.providerId).sort())
            .toEqual(PROVIDERS.map((provider) => provider.id).sort());
        const ids = report.providers.flatMap((row) => row.secrets.map((s) => s.secretId));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('checks no secret for a provider the vendor retired', async () => {
        const report = await diagnoseCredentialAccess({
            client: readableClient, fetchImpl: metadataAbsent,
        });
        const retired = report.providers.find((row) => row.providerId === 'github-models');

        expect(retired).toMatchObject({ retired: true, secrets: [] });
    });

    it('reports whether THIS runtime carries the legacy Groq deploy binding', async () => {
        const without = await diagnoseCredentialAccess({
            client: readableClient, fetchImpl: metadataAbsent,
        });
        expect(without.providers.find((row) => row.providerId === 'groq').legacyBinding).toBe(false);

        process.env.GROQ_API_KEY = 'legacy-key';
        const with_ = await diagnoseCredentialAccess({
            client: readableClient, fetchImpl: metadataAbsent,
        });
        expect(with_.providers.find((row) => row.providerId === 'groq').legacyBinding).toBe(true);
    });

    it('answers from a fresh read rather than the 60-second value cache', async () => {
        // A stale "absent" is exactly the answer that would send an operator in
        // circles, so the diagnosis clears the cache for each secret it checks.
        let calls = 0;
        const counting = {
            accessSecretVersion: async ({ name }) => {
                calls += 1;
                return readableClient.accessSecretVersion({ name });
            },
        };
        mockSecretStore.set('SAFEHAUL_AI_GEMINI_APIKEY', 'k');

        await diagnoseCredentialAccess({ client: counting, fetchImpl: metadataAbsent });
        const afterFirst = calls;
        await diagnoseCredentialAccess({ client: counting, fetchImpl: metadataAbsent });

        expect(calls).toBe(afterFirst * 2);
    });
});

describe('reason classification', () => {
    it('classifies by gRPC code, falling back to the message shape', () => {
        const { readFailureReason } = __test;

        expect(readFailureReason({ code: 7 })).toBe('permission_denied');
        expect(readFailureReason({ code: 8 })).toBe('resource_exhausted');
        expect(readFailureReason({ code: 14 })).toBe('unavailable');
        expect(readFailureReason({ code: 16 })).toBe('unauthenticated');
        expect(readFailureReason({ message: 'PERMISSION_DENIED on x' })).toBe('permission_denied');
        expect(readFailureReason({ message: 'UNAVAILABLE' })).toBe('unavailable');
        expect(readFailureReason({ message: 'something else' })).toBe('error');
    });
});
