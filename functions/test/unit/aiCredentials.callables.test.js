/**
 * The Super Admin callables that manage all of it.
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
// The mocked module, so this is the very `jest.fn()` the support file owns.
const { checkRateLimit } = require('../../shared/rateLimiter');
const {
    mockAuditWrites, mockFakeClient, requestOf, resetCredentialState,
} = require('./aiCredentials.support');

beforeEach(resetCredentialState);

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
