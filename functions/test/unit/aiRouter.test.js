/**
 * Shared AI router — routing order, capability gating and fallback.
 *
 * These are the load-bearing guarantees of the whole AI platform, so they are
 * asserted directly rather than inferred from a feature test. Nothing here
 * touches a network: every provider is a fake adapter, and the credential and
 * config stores are mocked.
 */

jest.mock('../../firebaseAdmin', () => ({
    admin: {
        firestore: {
            FieldValue: {
                serverTimestamp: () => 'ts',
                delete: () => 'delete',
            },
        },
    },
    db: { collection: () => ({ add: jest.fn(), doc: () => ({ set: jest.fn(), get: jest.fn() }) }) },
}));

// Telemetry writes are asserted separately; here they must simply never throw
// and never receive anything sensitive.
const mockRecordTelemetry = jest.fn().mockResolvedValue(undefined);
jest.mock('../../ai/telemetry/record', () => ({
    recordAiTelemetry: (...args) => mockRecordTelemetry(...args),
}));

const mockStore = {
    readAllConfigs: jest.fn(),
    resolveCredentials: jest.fn(),
    recordProviderOutcome: jest.fn().mockResolvedValue(undefined),
    cooldownState: jest.requireActual('../../ai/credentials/store').cooldownState,
};
jest.mock('../../ai/credentials/store', () => mockStore);

const mockExecute = jest.fn();
jest.mock('../../ai/providers', () => ({
    getAdapter: (provider) => ({
        id: provider.adapter,
        execute: (context) => mockExecute(provider.id, context),
    }),
}));

const { runAiTask, describeRouting, SKIP_REASONS } = require('../../ai/router/router');
const { AiError } = require('../../ai/router/errors');
const { CAPABILITIES } = require('../../ai/registry/capabilities');
const { PROVIDERS, DEFAULT_FALLBACK_ORDER } = require('../../ai/registry/providers');
const { TASK_TYPES, PRIVACY, defineTask } = require('../../ai/tasks/contract');

/** Every provider configured, enabled, no cooldown. */
function allConfigured(overrides = {}) {
    const configs = new Map();
    for (const provider of PROVIDERS) {
        configs.set(provider.id, {
            enabled: true,
            // Cloudflare needs a valid-looking account id to be eligible.
            accountId: 'a'.repeat(32),
            textModel: 'test/model',
            visionModel: 'test/vision-model',
            ...(overrides[provider.id] || {}),
        });
    }
    return configs;
}

function textTask(extra = {}) {
    return defineTask({
        taskType: TASK_TYPES.ARTICLE_GENERATION,
        capabilities: [CAPABILITIES.TEXT],
        inputText: 'Write something.',
        privacy: PRIVACY.PUBLIC,
        ...extra,
    });
}

function visionTask() {
    return defineTask({
        taskType: TASK_TYPES.CDL_EXTRACTION,
        capabilities: [CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON],
        inputText: 'Read this.',
        images: [{ dataUrl: 'data:image/png;base64,AAAA' }],
        outputSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
        },
        privacy: PRIVACY.RESTRICTED,
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockStore.readAllConfigs.mockResolvedValue(allConfigured());
    mockStore.resolveCredentials.mockResolvedValue({
        complete: true,
        values: { apiKey: 'k', apiToken: 't', token: 'g' },
        missing: [],
        source: 'secret-manager',
    });
    mockExecute.mockResolvedValue({ text: 'ok', model: 'test/model' });
});

describe('provider ordering', () => {
    it('publishes the required default fallback order', () => {
        expect(DEFAULT_FALLBACK_ORDER).toEqual([
            'groq',
            'gemini',
            'cloudflare',
            'github-models',
            'mistral',
            'cerebras',
            'sambanova',
            'openrouter',
            'huggingface',
        ]);
    });

    it('tries Groq first when everything is configured', async () => {
        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('groq');
        expect(result.fallbackCount).toBe(0);
        expect(mockExecute).toHaveBeenCalledTimes(1);
        expect(mockExecute.mock.calls[0][0]).toBe('groq');
    });

    it('falls back to Gemini second, then the registry order after that', async () => {
        // Groq, Gemini and Cloudflare all fail; the next *eligible* provider
        // must be Mistral, because GitHub Models is retired.
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'mistral') return { text: 'ok', model: 'm' };
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        const result = await runAiTask(textTask());

        expect(mockExecute.mock.calls.map((call) => call[0]))
            .toEqual(['groq', 'gemini', 'cloudflare', 'mistral']);
        expect(result.providerId).toBe('mistral');
        expect(result.fallbackCount).toBe(3);
    });

    it('never attempts the retired GitHub Models provider', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'huggingface') return { text: 'ok', model: 'h' };
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        await runAiTask(textTask());

        expect(mockExecute.mock.calls.map((call) => call[0])).not.toContain('github-models');
    });
});

describe('eligibility gating', () => {
    it('skips a disabled provider', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({ groq: { enabled: false } }));

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('gemini');
        expect(mockExecute.mock.calls.map((call) => call[0])).not.toContain('groq');
    });

    it('skips a provider with no credentials', async () => {
        mockStore.resolveCredentials.mockImplementation(async (providerId) => (
            providerId === 'groq'
                ? { complete: false, values: {}, missing: ['apiKey'], source: null }
                : { complete: true, values: { apiKey: 'k' }, missing: [], source: 'secret-manager' }
        ));

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('gemini');
    });

    it('skips a provider missing a required non-secret setting', async () => {
        // Cloudflare cannot be called without an account id, even with a token.
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({ cloudflare: { accountId: '' } }));
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'mistral') return { text: 'ok', model: 'm' };
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        await runAiTask(textTask());

        expect(mockExecute.mock.calls.map((call) => call[0])).not.toContain('cloudflare');
    });

    it('skips a provider in cooldown', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({
            groq: { cooldownUntil: Date.now() + 60000, cooldownReason: 'quota' },
        }));

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('gemini');
    });

    it('uses a provider again once its cooldown has expired', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({
            groq: { cooldownUntil: Date.now() - 1000, cooldownReason: 'quota' },
        }));

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('groq');
    });
});

describe('capability gating', () => {
    it('never sends an image to a text-only provider', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'mistral') return { text: '{"value":"x"}', model: 'p' };
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        await runAiTask(visionTask());

        const attempted = mockExecute.mock.calls.map((call) => call[0]);
        // Cloudflare, Cerebras and SambaNova declare no vision support.
        expect(attempted).not.toContain('cloudflare');
        expect(attempted).not.toContain('cerebras');
        expect(attempted).not.toContain('sambanova');
        // Groq is absent too: it declared vision until Groq withdrew both
        // llama-4 vision models, and a capability with no surviving model is
        // worse than no capability — the router would spend a request to learn
        // the model is gone. Gemini leads on vision now.
        expect(attempted).not.toContain('groq');
        expect(attempted).toEqual(['gemini', 'mistral']);
    });

    it('routes CDL and E-Doc images to Gemini first, not Groq', async () => {
        // The migration's whole point was that vision stops depending on one
        // vendor. Groq removing its vision models is exactly the event that
        // should be invisible to the feature.
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'gemini') return { text: '{"value":"x"}', model: 'g' };
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        const result = await runAiTask(visionTask());

        expect(result.providerId).toBe('gemini');
        expect(result.fallbackCount).toBe(0);
    });

    it('refuses a task that carries images without declaring vision', async () => {
        // Defence in depth: the contract should prevent this, so if it ever
        // arrives the router must refuse rather than pick a provider.
        const malformed = {
            taskType: TASK_TYPES.CDL_EXTRACTION,
            capabilities: [CAPABILITIES.TEXT],
            inputText: 'x',
            images: [{ dataUrl: 'data:image/png;base64,AAAA' }],
        };

        await expect(runAiTask(malformed)).rejects.toMatchObject({ category: 'invalid_request' });
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('reports capability_unavailable when no provider supports the task', async () => {
        // Only Hugging Face declares vision without multi-image, and every
        // vision provider is disabled here.
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({
            groq: { enabled: false },
            gemini: { enabled: false },
            mistral: { enabled: false },
            openrouter: { enabled: false },
            huggingface: { enabled: false },
        }));

        await expect(runAiTask(visionTask())).rejects.toMatchObject({ category: 'not_configured' });
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('failure handling and fallback triggers', () => {
    const failureCases = [
        ['timeout', 'timeout'],
        ['a network error', 'network'],
        ['a provider outage', 'provider_unavailable'],
        ['an exhausted quota', 'quota_exceeded'],
        ['a rate limit', 'rate_limited'],
        ['an unavailable model', 'model_unavailable'],
        ['a malformed response', 'malformed_response'],
        ['failed schema validation', 'schema_validation_failed'],
    ];

    it.each(failureCases)('falls back on %s', async (_label, category) => {
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'groq') throw new AiError(category, 'x', { providerId });
            return { text: 'ok', model: 'g' };
        });

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('gemini');
        expect(result.fallbackCount).toBe(1);
    });

    it('stops immediately on an invalid SafeHaul request', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            throw new AiError('invalid_request', 'bad shape', { providerId });
        });

        await expect(runAiTask(textTask())).rejects.toMatchObject({ category: 'invalid_request' });
        expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    // These four replace an earlier test that asserted the router "stops
    // immediately when a provider rejects our credentials". That was the wrong
    // guarantee, and asserting it kept a real defect in place.
    //
    // `retryable: false` answers "retry this provider?" — not "try the other
    // eight?". Treating the two as one meant a single revoked Groq key, or one
    // unexpected exception in the Groq adapter, threw before Gemini was reached.
    // Since Groq is priority 1, the platform then behaved as if no provider were
    // configured, while reporting a message that blamed the request.

    it('fails over when one provider rejects our credentials', async () => {
        // One vendor's key being wrong, expired or revoked says nothing about
        // the other eight.
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'groq') throw new AiError('unauthorized', '401', { providerId });
            return { text: 'ok', model: 'g' };
        });

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('gemini');
        expect(result.fallbackCount).toBe(1);
    });

    it('fails over when one adapter throws an unexpected error', async () => {
        // Not an AiError, so the router labels it `internal`. A bug in one
        // adapter must not disable every AI feature.
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'groq') throw new TypeError('Cannot read properties of undefined');
            return { text: 'ok', model: 'g' };
        });

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('gemini');
        expect(result.fallbackCount).toBe(1);
    });

    it('does not retry the same provider after a non-retryable failure', async () => {
        // Failing over is right; hammering the provider that just rejected the
        // credential is not.
        mockExecute.mockImplementation(async (providerId) => {
            throw new AiError('unauthorized', '401', { providerId });
        });

        await runAiTask(textTask()).catch(() => {});

        const attempted = mockExecute.mock.calls.map((call) => call[0]);
        expect(attempted.filter((id) => id === 'groq').length).toBe(1);
        // Every eligible provider still got its turn.
        expect(new Set(attempted).size).toBeGreaterThan(1);
    });

    it('still stops immediately on an unauthorized *task-fatal* category', async () => {
        // `invalid_request` genuinely is task-fatal: our own request is
        // malformed, so every vendor would reject it identically.
        mockExecute.mockImplementation(async (providerId) => {
            throw new AiError('invalid_request', 'bad shape', { providerId });
        });

        await expect(runAiTask(textTask())).rejects.toMatchObject({ category: 'invalid_request' });
        expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('returns a safe error, not a fabricated answer, when everything fails', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        const error = await runAiTask(textTask()).catch((err) => err);

        expect(error.category).toBe('all_providers_failed');
        expect(error.safeMessage).toBe('Every configured AI provider failed to complete this request.');
        expect(error.toSafeJSON()).toEqual({
            category: 'all_providers_failed',
            message: 'Every configured AI provider failed to complete this request.',
        });
    });

    it('attempts each provider once and does not loop', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        await runAiTask(textTask()).catch(() => {});

        const attempted = mockExecute.mock.calls.map((call) => call[0]);
        // Hugging Face is the one provider whose registry row permits a single
        // documented safe retry; everything else is exactly one attempt.
        const groqAttempts = attempted.filter((id) => id === 'groq').length;
        expect(groqAttempts).toBe(1);
        expect(attempted.filter((id) => id === 'huggingface').length).toBeLessThanOrEqual(2);
        expect(attempted.length).toBeLessThanOrEqual(PROVIDERS.length + 1);
    });

    it('records a quota failure so the provider enters cooldown', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'groq') throw new AiError('quota_exceeded', '429', { providerId });
            return { text: 'ok', model: 'g' };
        });

        await runAiTask(textTask());

        expect(mockStore.recordProviderOutcome).toHaveBeenCalledWith('groq', {
            success: false,
            category: 'quota_exceeded',
        });
    });
});

describe('structured output validation', () => {
    const schemaTask = () => defineTask({
        taskType: TASK_TYPES.TOPIC_SELECTION,
        capabilities: [CAPABILITIES.TEXT, CAPABILITIES.STRUCTURED_JSON],
        inputText: 'Pick one.',
        outputSchema: {
            type: 'object',
            properties: { topic: { type: 'string' }, score: { type: 'number' } },
            required: ['topic'],
            additionalProperties: false,
        },
        privacy: PRIVACY.PUBLIC,
    });

    it('accepts valid JSON and stops falling back', async () => {
        mockExecute.mockResolvedValue({ text: '{"topic":"hours of service"}', model: 'm' });

        const result = await runAiTask(schemaTask());

        expect(result.output).toEqual({ topic: 'hours of service' });
        expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('falls back when a provider returns unparseable output', async () => {
        mockExecute.mockImplementation(async (providerId) => (
            providerId === 'groq'
                ? { text: 'I cannot do that.', model: 'm' }
                : { text: '{"topic":"brake inspections"}', model: 'g' }
        ));

        const result = await runAiTask(schemaTask());

        expect(result.providerId).toBe('gemini');
        expect(result.output).toEqual({ topic: 'brake inspections' });
    });

    it('falls back when JSON parses but violates the schema', async () => {
        mockExecute.mockImplementation(async (providerId) => (
            providerId === 'groq'
                // Extra key, and the schema forbids additional properties.
                ? { text: '{"topic":"x","injected":"y"}', model: 'm' }
                : { text: '{"topic":"clean"}', model: 'g' }
        ));

        const result = await runAiTask(schemaTask());

        expect(result.providerId).toBe('gemini');
        expect(result.output).toEqual({ topic: 'clean' });
    });

    it('tolerates a fenced code block around the JSON', async () => {
        mockExecute.mockResolvedValue({ text: '```json\n{"topic":"eld"}\n```', model: 'm' });

        const result = await runAiTask(schemaTask());

        expect(result.output).toEqual({ topic: 'eld' });
    });
});

describe('telemetry and secrecy', () => {
    it('records the provider, model and fallback count on success', async () => {
        await runAiTask(textTask());

        expect(mockRecordTelemetry).toHaveBeenCalledWith(expect.objectContaining({
            taskType: TASK_TYPES.ARTICLE_GENERATION,
            providerId: 'groq',
            outcome: 'success',
            fallbackCount: 0,
        }));
    });

    it('never puts a credential or prompt into telemetry', async () => {
        mockStore.resolveCredentials.mockResolvedValue({
            complete: true,
            values: { apiKey: 'sk-super-secret-value' },
            missing: [],
            source: 'secret-manager',
        });

        await runAiTask(textTask({ inputText: 'A very identifying prompt about Jane Doe.' }));

        const serialized = JSON.stringify(mockRecordTelemetry.mock.calls);
        expect(serialized).not.toContain('sk-super-secret-value');
        expect(serialized).not.toContain('Jane Doe');
    });

    it('never puts a credential into an error surfaced to a caller', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        const error = await runAiTask(textTask()).catch((err) => err);

        expect(JSON.stringify(error.toSafeJSON())).not.toMatch(/sk-|Bearer|apiKey/);
    });
});

describe('describeRouting', () => {
    it('explains why each provider is or is not eligible', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({ gemini: { enabled: false } }));

        const rows = await describeRouting([CAPABILITIES.VISION]);
        const byId = Object.fromEntries(rows.map((row) => [row.providerId, row]));

        // Groq is INCAPABLE for vision now, not eligible: its llama-4 vision
        // models were withdrawn by the vendor, so the registry no longer claims
        // the capability. The console must say so rather than offering it.
        expect(byId.groq).toMatchObject({ eligible: false, reason: SKIP_REASONS.INCAPABLE });
        expect(byId.gemini).toMatchObject({ eligible: false, reason: SKIP_REASONS.DISABLED });
        expect(byId.cerebras).toMatchObject({ eligible: false, reason: SKIP_REASONS.INCAPABLE });
        expect(byId['github-models']).toMatchObject({ eligible: false, reason: SKIP_REASONS.RETIRED });
    });
});
