/**
 * Routing order and gating: the default order, the operator-chosen order,
 * eligibility and capability.
 *
 * Part of the `aiRouter` suite. The provider fakes, the credential and config
 * doubles, the task builders and the reset are in `aiRouter.support.js`. Each
 * `jest.mock` below has to stay in this file, because Jest hoists it per file
 * and cannot register one from a helper.
 */

jest.mock('../../firebaseAdmin', () => require('./aiRouter.support').firebaseAdminMock());
jest.mock('../../ai/telemetry/record', () => require('./aiRouter.support').telemetryMock());
jest.mock('../../ai/credentials/store', () => require('./aiRouter.support').credentialsStoreMock());
jest.mock('../../ai/providers', () => require('./aiRouter.support').providersMock());

const { runAiTask } = require('../../ai/router/router');
const { AiError } = require('../../ai/router/errors');
const { CAPABILITIES } = require('../../ai/registry/capabilities');
const { DEFAULT_FALLBACK_ORDER } = require('../../ai/registry/providers');
const { TASK_TYPES, PRIVACY, defineTask } = require('../../ai/tasks/contract');
const {
    mockRecordTelemetry, mockStore, mockExecute, allConfigured, textTask, visionTask,
    resetAiRouterState,
} = require('./aiRouter.support');

beforeEach(resetAiRouterState);

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
