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
    // Only the *write* is faked. `describeTaskInput` and the attempt cap are
    // real, because what they produce is exactly what these tests assert about
    // — a request description built from shape rather than content, and a
    // bounded attempts array.
    ...jest.requireActual('../../ai/telemetry/record'),
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
        // Gemini leads and Groq is the fallback. The brief specified Groq first;
        // the owner reversed it on 2026-08-03 after measurement — on the free
        // tiers Groq's model writes 175-213 word articles against Gemini's
        // 311-417, while Gemini's request cap makes it the less available of the
        // two. Gemini for quality, Groq for availability.
        expect(DEFAULT_FALLBACK_ORDER).toEqual([
            'gemini',
            'groq',
            'cloudflare',
            'github-models',
            'mistral',
            'cerebras',
            'sambanova',
            'openrouter',
            'huggingface',
        ]);
    });

    it('tries Gemini first when everything is configured', async () => {
        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('gemini');
        expect(result.fallbackCount).toBe(0);
        expect(mockExecute).toHaveBeenCalledTimes(1);
        expect(mockExecute.mock.calls[0][0]).toBe('gemini');
    });

    it('falls back to Groq second, then the registry order after that', async () => {
        // Gemini, Groq and Cloudflare all fail; the next *eligible* provider
        // must be Mistral, because GitHub Models is retired.
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'mistral') return { text: 'ok', model: 'm' };
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        const result = await runAiTask(textTask());

        expect(mockExecute.mock.calls.map((call) => call[0]))
            .toEqual(['gemini', 'groq', 'cloudflare', 'mistral']);
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

describe('the operator-chosen routing order', () => {
    it('changes which provider is asked first', async () => {
        const result = await runAiTask(textTask(), { providerOrder: ['mistral', 'gemini'] });

        expect(result.providerId).toBe('mistral');
        expect(mockExecute.mock.calls[0][0]).toBe('mistral');
    });

    it('changes the whole fallback sequence, not just the head', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'cerebras') return { text: 'ok', model: 'c' };
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        await runAiTask(textTask(), { providerOrder: ['mistral', 'openrouter', 'cerebras'] });

        expect(mockExecute.mock.calls.map((call) => call[0]))
            .toEqual(['mistral', 'openrouter', 'cerebras']);
    });

    it('leaves unranked providers behind the ranked ones, in registry order', async () => {
        mockExecute.mockImplementation(async () => {
            throw new AiError('provider_unavailable', 'down');
        });

        // Every provider fails, so the walk is exhaustive and the attempt trail
        // is the whole effective order.
        await expect(runAiTask(textTask(), { providerOrder: ['huggingface'] }))
            .rejects.toMatchObject({ category: 'all_providers_failed' });

        // Collapsed to the walk rather than the raw call list: Hugging Face
        // carries `ONE_SAFE_RETRY` in the registry, so it is called twice in a
        // row. That is its retry policy, which ordering does not change, and
        // asserting it here would make this test fail for the wrong reason.
        const walk = mockExecute.mock.calls
            .map((call) => call[0])
            .filter((id, index, all) => id !== all[index - 1]);

        // Hugging Face first, then the registry order minus Hugging Face and
        // minus the retired row, which is skipped rather than attempted.
        expect(walk).toEqual([
            'huggingface', 'gemini', 'groq', 'cloudflare',
            'mistral', 'cerebras', 'sambanova', 'openrouter',
        ]);
    });

    it('falls back to the registry order when the stored order is unusable', async () => {
        // Each of these is a real degradation case: no document, an emptied
        // list, a corrupted field, and a list naming only providers that no
        // longer exist. None of them may stop AI working.
        for (const stored of [[], null, 'gemini,groq', ['gone', 'also-gone']]) {
            mockExecute.mockClear();
            const result = await runAiTask(textTask(), { providerOrder: stored });
            expect(result.providerId).toBe('gemini');
        }
    });

    it('cannot promote a provider past a capability gate', async () => {
        // Cerebras declares no vision models. Ranking it first must not send it
        // a CDL photograph — ordering decides who is asked first, not who is
        // eligible, and that is the whole safety argument for this feature.
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'gemini') return { text: '{"value":"x"}', model: 'g' };
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        const result = await runAiTask(visionTask(), {
            providerOrder: ['cerebras', 'cloudflare', 'gemini'],
        });

        const attempted = mockExecute.mock.calls.map((call) => call[0]);
        expect(attempted).not.toContain('cerebras');
        expect(attempted).not.toContain('cloudflare');
        expect(result.providerId).toBe('gemini');
    });

    it('lets an operator put a vision-capable provider first for image work', async () => {
        // The other half of the same argument. Ordering is the operator's to
        // set: a provider that *is* capable must be reachable at position one
        // for image tasks, not just for text.
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'groq') return { text: '{"value":"x"}', model: 'qwen/qwen3.6-27b' };
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        const result = await runAiTask(visionTask(), {
            providerOrder: ['groq', 'gemini'],
        });

        expect(result.providerId).toBe('groq');
        expect(mockExecute.mock.calls[0][0]).toBe('groq');
    });

    it('cannot promote a disabled provider into the walk', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({ mistral: { enabled: false } }));

        const result = await runAiTask(textTask(), { providerOrder: ['mistral', 'gemini'] });

        expect(result.providerId).toBe('gemini');
        expect(mockExecute.mock.calls.map((call) => call[0])).not.toContain('mistral');
    });

    it('cannot promote a provider out of its cooldown', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({
            mistral: { cooldownUntil: Date.now() + 60000, cooldownReason: 'quota' },
        }));

        const result = await runAiTask(textTask(), { providerOrder: ['mistral', 'gemini'] });

        expect(result.providerId).toBe('gemini');
    });

    it('still reports fallbacks and attempts truthfully under a custom order', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'cerebras') return { text: 'ok', model: 'c' };
            throw new AiError('provider_unavailable', 'down', { providerId });
        });

        const result = await runAiTask(textTask(), {
            providerOrder: ['sambanova', 'openrouter', 'cerebras'],
        });

        expect(result.fallbackCount).toBe(2);
        expect(mockRecordTelemetry).toHaveBeenCalledWith(expect.objectContaining({
            providerId: 'cerebras',
            fallbackCount: 2,
            attemptedProviders: ['sambanova', 'openrouter', 'cerebras'],
        }));
    });
});

describe('eligibility gating', () => {
    it('skips a disabled provider', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({ gemini: { enabled: false } }));

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('groq');
        expect(mockExecute.mock.calls.map((call) => call[0])).not.toContain('gemini');
    });

    it('skips a provider with no credentials', async () => {
        mockStore.resolveCredentials.mockImplementation(async (providerId) => (
            providerId === 'gemini'
                ? { complete: false, values: {}, missing: ['apiKey'], source: null }
                : { complete: true, values: { apiKey: 'k' }, missing: [], source: 'secret-manager' }
        ));

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('groq');
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
            gemini: { cooldownUntil: Date.now() + 60000, cooldownReason: 'quota' },
        }));

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('groq');
    });

    it('uses a provider again once its cooldown has expired', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({
            gemini: { cooldownUntil: Date.now() - 1000, cooldownReason: 'quota' },
        }));

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('gemini');
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
        // Cloudflare, Cerebras and SambaNova declare no vision support, so a
        // CDL photograph can never reach them however the order is set.
        expect(attempted).not.toContain('cloudflare');
        expect(attempted).not.toContain('cerebras');
        expect(attempted).not.toContain('sambanova');
        // Gemini leads on vision by default; Groq is capable again on
        // `qwen/qwen3.6-27b` and sits at its registry priority behind it.
        expect(attempted).toEqual(['gemini', 'groq', 'mistral']);
    });

    it('skips a provider that cannot take this many images, rather than 400ing', async () => {
        // Groq caps at five images per request. Asking for six is a guaranteed
        // 400, so the request is never spent finding that out.
        const sixPages = defineTask({
            taskType: TASK_TYPES.EDOC_FIELD_PLACEMENT,
            capabilities: [CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON, CAPABILITIES.MULTI_IMAGE],
            inputText: 'Read these.',
            images: Array.from({ length: 6 }, () => ({ dataUrl: 'data:image/png;base64,AAAA' })),
            privacy: PRIVACY.RESTRICTED,
        });
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'gemini') throw new AiError('provider_unavailable', 'down', { providerId });
            return { text: 'ok', model: 'm' };
        });

        await runAiTask(sixPages);

        expect(mockExecute.mock.calls.map((call) => call[0])).not.toContain('groq');
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
            if (providerId === 'gemini') throw new AiError(category, 'x', { providerId });
            return { text: 'ok', model: 'g' };
        });

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('groq');
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
            if (providerId === 'gemini') throw new AiError('unauthorized', '401', { providerId });
            return { text: 'ok', model: 'g' };
        });

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('groq');
        expect(result.fallbackCount).toBe(1);
    });

    it('fails over when one adapter throws an unexpected error', async () => {
        // Not an AiError, so the router labels it `internal`. A bug in one
        // adapter must not disable every AI feature.
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'gemini') throw new TypeError('Cannot read properties of undefined');
            return { text: 'ok', model: 'g' };
        });

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('groq');
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
        expect(attempted.filter((id) => id === 'gemini').length).toBe(1);
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

    it('honours a vendor-stated wait and retries that provider once', async () => {
        // Groq refuses a request over its per-minute token budget and states the
        // reset in its headers ("x-ratelimit-reset-tokens: 7.222s"). Abandoning a
        // working provider over seven seconds, against a two-minute deadline, is
        // what made the blog unable to publish on a per-minute token budget.
        let groqCalls = 0;
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId !== 'gemini') throw new AiError('provider_unavailable', 'down', { providerId });
            groqCalls += 1;
            if (groqCalls === 1) {
                throw new AiError('rate_limited', '429', { providerId, retryAfterMs: 5 });
            }
            return { text: 'ok', model: 'g' };
        });

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('gemini');
        expect(groqCalls).toBe(2);
        // No failover happened: the same provider answered on its second turn.
        expect(result.fallbackCount).toBe(0);
    });

    it('waits only once, then moves on', async () => {
        // A provider that keeps saying "come back later" must not hold the task.
        let groqCalls = 0;
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'gemini') {
                groqCalls += 1;
                throw new AiError('rate_limited', '429', { providerId, retryAfterMs: 5 });
            }
            return { text: 'ok', model: 'g' };
        });

        const result = await runAiTask(textTask());

        expect(groqCalls).toBe(2);
        expect(result.providerId).toBe('groq');
    });

    it('does not wait when the vendor gave no hint', async () => {
        // Absent or over-long hints are dropped by http.js, so the router must
        // fall over immediately rather than inventing a delay.
        let groqCalls = 0;
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'gemini') {
                groqCalls += 1;
                throw new AiError('rate_limited', '429', { providerId });
            }
            return { text: 'ok', model: 'g' };
        });

        const result = await runAiTask(textTask());

        expect(groqCalls).toBe(1);
        expect(result.providerId).toBe('groq');
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
        const groqAttempts = attempted.filter((id) => id === 'gemini').length;
        expect(groqAttempts).toBe(1);
        expect(attempted.filter((id) => id === 'huggingface').length).toBeLessThanOrEqual(2);
        expect(attempted.length).toBeLessThanOrEqual(PROVIDERS.length + 1);
    });

    it('records a quota failure so the provider enters cooldown', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'gemini') throw new AiError('quota_exceeded', '429', { providerId });
            return { text: 'ok', model: 'g' };
        });

        await runAiTask(textTask());

        expect(mockStore.recordProviderOutcome).toHaveBeenCalledWith('gemini', {
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
            // Gemini is priority 1, so an unforced success is Gemini's.
            providerId: 'gemini',
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

describe('transaction logging', () => {
    /**
     * The gap this closes: telemetry recorded exactly one row per task, on final
     * success or terminal failure. Every intermediate provider failure existed
     * nowhere — it survived only inside the `all_providers_failed` message
     * string and as a counter on `ai_provider_config`. An operator could see
     * that CDL extraction failed and not which providers were tried, in what
     * order, or why each declined.
     */
    it('records one transaction carrying every provider attempt in order', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'gemini') {
                throw new AiError('quota_exceeded', 'HTTP 429', {
                    providerId, status: 429, vendorCode: 'resource_exhausted',
                });
            }
            if (providerId === 'groq') {
                throw new AiError('model_unavailable', 'HTTP 404', {
                    providerId, status: 404, vendorCode: 'model_not_found',
                });
            }
            return { text: '{"value":"x"}', model: 'mistral-large-latest', usage: { inputTokens: 900, outputTokens: 120 } };
        });

        const result = await runAiTask(visionTask());
        const recorded = mockRecordTelemetry.mock.calls[0][0];

        expect(recorded.outcome).toBe('success');
        expect(recorded.transactionId).toEqual(expect.any(String));
        expect(result.transactionId).toBe(recorded.transactionId);
        expect(recorded.fallbackCount).toBe(2);

        // The timeline an operator reads in the Logs detail view.
        const attempted = recorded.attempts.filter((entry) => entry.status === 'attempted');
        expect(attempted.map((entry) => [entry.providerId, entry.category ?? 'success'])).toEqual([
            ['gemini', 'quota_exceeded'],
            ['groq', 'model_unavailable'],
            ['mistral', 'success'],
        ]);

        // Enough per attempt to say *why* fallback happened, and where it went.
        expect(attempted[0]).toMatchObject({
            httpStatus: 429,
            vendorCode: 'resource_exhausted',
            nextProviderId: 'groq',
            success: false,
        });
        expect(attempted[1]).toMatchObject({ httpStatus: 404, vendorCode: 'model_not_found' });
        expect(attempted[2]).toMatchObject({
            success: true,
            schemaValid: true,
            inputTokens: 900,
            outputTokens: 120,
        });
    });

    it('records why a provider was never asked, not only the ones that were', async () => {
        // `describeRouting` answers this for *now*; the transaction answers it
        // for a request that already happened, which is the one an operator is
        // usually looking at.
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({ gemini: { enabled: false } }));
        mockExecute.mockResolvedValue({ text: '{"value":"x"}', model: 'test/model' });

        // An explicit order, so the two skips are reached before the success
        // that ends the walk. Only providers the router actually considered are
        // recorded — it stops at the first provider that answers, and that is
        // the behaviour being relied on here rather than worked around.
        await runAiTask(visionTask(), {
            providerOrder: ['cloudflare', 'gemini', 'mistral'],
        });
        const recorded = mockRecordTelemetry.mock.calls[0][0];
        const byProvider = Object.fromEntries(
            recorded.attempts.map((entry) => [entry.providerId, entry]),
        );

        // Two different reasons, needing two different operator actions:
        // Cloudflare can never serve an image, Gemini was switched off.
        expect(byProvider.cloudflare).toMatchObject({ status: 'skipped', skipReason: SKIP_REASONS.INCAPABLE });
        expect(byProvider.gemini).toMatchObject({ status: 'skipped', skipReason: SKIP_REASONS.DISABLED });
        expect(byProvider.mistral).toMatchObject({ status: 'attempted', success: true });
    });

    it('records a transaction even when every provider fails', async () => {
        mockExecute.mockRejectedValue(new AiError('provider_unavailable', 'down'));

        await expect(runAiTask(textTask())).rejects.toMatchObject({ category: 'all_providers_failed' });

        const recorded = mockRecordTelemetry.mock.calls[0][0];
        expect(recorded.outcome).toBe('failure');
        expect(recorded.transactionId).toEqual(expect.any(String));
        expect(recorded.attempts.length).toBeGreaterThan(1);
        expect(recorded.attempts.every((entry) => entry.success === false)).toBe(true);
    });

    it('describes the request by shape, never by content', async () => {
        mockExecute.mockResolvedValue({ text: '{"value":"x"}', model: 'test/model' });

        await runAiTask(visionTask());
        const recorded = mockRecordTelemetry.mock.calls[0][0];

        expect(recorded.inputSummary).toContain('1 image (image/png)');
        expect(recorded.inputSummary).toContain('1 structured field requested');
        // `visionTask` prompts with "Read this."; not a word of it may appear.
        expect(recorded.inputSummary).not.toMatch(/Read this/);
    });

    it('never puts a credential, prompt or image into an attempt record', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            throw new AiError('provider_request_rejected', 'HTTP 400', { providerId, status: 400 });
        });

        await expect(runAiTask(visionTask())).rejects.toThrow();

        const recorded = JSON.stringify(mockRecordTelemetry.mock.calls);
        expect(recorded).not.toMatch(/base64/);
        expect(recorded).not.toMatch(/AAAA/);
        expect(recorded).not.toMatch(/Read this/);
        expect(recorded).not.toMatch(/apiKey/);
    });
});

describe('infrastructure failures do not become task failures', () => {
    /**
     * The defect these pin down: `evaluateProvider` reads Secret Manager, and
     * `credentials/secretManager.js` deliberately re-throws anything that is not
     * NOT_FOUND — `PERMISSION_DENIED` when the runtime service account has lost
     * `roles/secretmanager.secretAccessor`, `UNAVAILABLE`, a project quota
     * error. The router had no `catch` around the walk, only a `finally`, so
     * that exception escaped `runAiTask` raw: no telemetry, no categorised
     * error, and no attempt at any remaining provider.
     *
     * One vendor's IAM binding could therefore switch off all nine — the same
     * class of defect already fixed once for `unauthorized` and `internal`, and
     * the single most likely explanation for "AI stopped working entirely".
     */
    it('fails over when one provider credential cannot be read at all', async () => {
        mockStore.resolveCredentials.mockImplementation(async (providerId) => {
            if (providerId === 'gemini') {
                const error = new Error('7 PERMISSION_DENIED: Permission denied on secret');
                error.code = 7;
                throw error;
            }
            return { complete: true, values: { apiKey: 'k' }, missing: [], source: 'secret-manager' };
        });

        const result = await runAiTask(textTask());

        // Gemini leads by default, so before the fix this returned nothing at all.
        expect(result.providerId).toBe('groq');
        expect(mockExecute).toHaveBeenCalledWith('groq', expect.anything());
    });

    it('records the unreadable credential as a skip reason rather than an outage', async () => {
        mockStore.resolveCredentials.mockImplementation(async (providerId) => {
            if (providerId !== 'gemini') {
                return { complete: true, values: { apiKey: 'k' }, missing: [], source: 'secret-manager' };
            }
            throw new Error('14 UNAVAILABLE');
        });

        const rows = await describeRouting([CAPABILITIES.TEXT]);
        const byId = Object.fromEntries(rows.map((row) => [row.providerId, row]));

        expect(byId.gemini).toMatchObject({
            eligible: false,
            reason: SKIP_REASONS.CREDENTIAL_ERROR,
        });
    });

    it('never lets a Secret Manager error message reach telemetry', async () => {
        mockStore.resolveCredentials.mockImplementation(async (providerId) => {
            if (providerId === 'gemini') {
                throw new Error('PERMISSION_DENIED on projects/x/secrets/SAFEHAUL_AI_GEMINI_APIKEY');
            }
            return { complete: true, values: { apiKey: 'k' }, missing: [], source: 'secret-manager' };
        });

        await runAiTask(textTask());

        const recorded = JSON.stringify(mockRecordTelemetry.mock.calls);
        expect(recorded).not.toMatch(/SAFEHAUL_AI_GEMINI_APIKEY/);
        expect(recorded).not.toMatch(/PERMISSION_DENIED/);
    });

    it('degrades to registry defaults when provider config cannot be read', async () => {
        // Enabled/disabled is a preference. A Firestore blip must not read as
        // "every provider is disabled" and take AI down with it.
        mockStore.readAllConfigs.mockRejectedValue(new Error('firestore unavailable'));

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('gemini');
    });

    it('still produces a categorised error and telemetry if the walk throws unexpectedly', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured());
        mockStore.recordProviderOutcome.mockRejectedValue(new Error('boom'));
        mockExecute.mockRejectedValue(new AiError('provider_unavailable', 'down'));

        await expect(runAiTask(textTask())).rejects.toMatchObject({ category: 'internal' });
        expect(mockRecordTelemetry).toHaveBeenCalledWith(
            expect.objectContaining({ outcome: 'failure', category: 'internal' }),
        );
    });
});

describe('image handling before any provider is tried', () => {
    it('rejects a malformed image once, centrally, without spending a request', async () => {
        const task = defineTask({
            taskType: TASK_TYPES.CDL_EXTRACTION,
            capabilities: [CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON],
            inputText: 'Read this.',
            images: [{ dataUrl: 'https://example.com/not-a-data-url.png' }],
            privacy: PRIVACY.RESTRICTED,
        });

        await expect(runAiTask(task)).rejects.toMatchObject({ category: 'invalid_request' });
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('never puts image bytes into the error raised for a malformed image', async () => {
        const task = defineTask({
            taskType: TASK_TYPES.CDL_EXTRACTION,
            capabilities: [CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON],
            inputText: 'Read this.',
            images: [{ dataUrl: 'data:image/png;NOTBASE64,SECRETLICENCEBYTES' }],
            privacy: PRIVACY.RESTRICTED,
        });

        // `detail` names which image was wrong, for diagnosis; the public
        // `message` stays generic and neither carries a byte of the image.
        const error = await runAiTask(task).catch((thrown) => thrown);

        expect(error.detail).toMatch(/Image 1 is not a base64 data URL/);
        expect(JSON.stringify(error.toSafeJSON())).not.toMatch(/SECRETLICENCEBYTES/);
        expect(`${error.message} ${error.detail}`).not.toMatch(/SECRETLICENCEBYTES/);
    });
});

describe('deadline reporting', () => {
    it('reports a deadline as a deadline, not as a configuration gap', async () => {
        const { buildTerminalFailure } = require('../../ai/router/router').__test;

        // Nothing was attempted because time ran out first. Reporting
        // `not_configured` here sends an operator to check credentials that
        // were never the problem.
        const failure = buildTerminalFailure({
            attempted: [],
            skipped: [],
            lastError: new AiError('deadline_exceeded', 'Total AI deadline reached.'),
            failures: [],
        });

        expect(failure.category).toBe('deadline_exceeded');
    });

    it('reports a deadline as a deadline even after providers were attempted', async () => {
        const { buildTerminalFailure } = require('../../ai/router/router').__test;

        const failure = buildTerminalFailure({
            attempted: ['gemini'],
            skipped: [],
            lastError: new AiError('deadline_exceeded', 'Total AI deadline reached.'),
            failures: [{ providerId: 'gemini', category: 'timeout' }],
        });

        expect(failure.category).toBe('deadline_exceeded');
    });
});

describe('describeRouting', () => {
    it('explains why each provider is or is not eligible', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({ gemini: { enabled: false } }));

        const rows = await describeRouting([CAPABILITIES.VISION]);
        const byId = Object.fromEntries(rows.map((row) => [row.providerId, row]));

        // Groq is eligible for vision again, on `qwen/qwen3.6-27b`. The console
        // must show the model it would actually use, so an operator deciding
        // the order can see what each lane resolves to.
        expect(byId.groq).toMatchObject({ eligible: true, model: 'qwen/qwen3.6-27b' });
        expect(byId.gemini).toMatchObject({ eligible: false, reason: SKIP_REASONS.DISABLED });
        expect(byId.cerebras).toMatchObject({ eligible: false, reason: SKIP_REASONS.INCAPABLE });
        expect(byId['github-models']).toMatchObject({ eligible: false, reason: SKIP_REASONS.RETIRED });
    });
});
