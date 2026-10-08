/**
 * Spare model versions: which failures move to the next version of the same
 * provider, which move to the next provider, and the time it may take.
 *
 * Part of the `aiRouter` suite. The provider fakes, the credential and config
 * doubles, the task builders and the reset are in `aiRouter.support.js`. Each
 * `jest.mock` below has to stay in this file, because Jest hoists it per file
 * and cannot register one from a helper. Rests are in aiRouter.versionRest.
 */

jest.mock('../../firebaseAdmin', () => require('./aiRouter.support').firebaseAdminMock());
jest.mock('../../ai/telemetry/record', () => require('./aiRouter.support').telemetryMock());
jest.mock('../../ai/credentials/store', () => require('./aiRouter.support').credentialsStoreMock());
jest.mock('../../ai/providers', () => require('./aiRouter.support').providersMock());

const { runAiTask } = require('../../ai/router/router');
const { AiError } = require('../../ai/router/errors');
const { CAPABILITIES } = require('../../ai/registry/capabilities');
const { TASK_TYPES, PRIVACY, defineTask } = require('../../ai/tasks/contract');
const {
    mockRecordTelemetry, mockStore, mockExecute, allConfigured, textTask, resetAiRouterState,
} = require('./aiRouter.support');

beforeEach(resetAiRouterState);

/** Mistral reads photos on three versions, so it is first in these walks. */
const MISTRAL_FIRST = { providerOrder: ['mistral', 'groq'] };
const [FIRST, SECOND, THIRD] = ['ministral-14b-2512', 'ministral-8b-2512', 'mistral-medium-latest'];

/** A licence read as the driver-facing tasks run it: 45s in all, 20s an attempt. */
function readTask() {
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
        totalDeadlineMs: 45000,
        perAttemptDeadlineMs: 20000,
    });
}

/**
 * Scripts the vendors: `provider/model` (or a bare provider id) maps to the
 * error that call throws. Anything unscripted answers correctly.
 */
function vendors(script) {
    mockExecute.mockImplementation(async (providerId, context) => {
        const outcome = script[`${providerId}/${context.model}`] ?? script[providerId];
        if (typeof outcome === 'function') return outcome(context);
        if (outcome) throw outcome;
        return { text: '{"value":"x"}', model: context.model };
    });
}

const fail = (category, extra = {}) => new AiError(category, `HTTP ${extra.status || 0}`, extra);

/** Every call, as `provider/model`, in order. */
function asked() {
    return mockExecute.mock.calls.map(([providerId, context]) => `${providerId}/${context.model}`);
}

describe('a failure about one version moves to the next version', () => {
    it.each([
        ['the vendor withdrew it (404)', fail('model_unavailable', { status: 404, vendorCode: 'model_not_found' })],
        ['this plan gives it a limit of zero', fail('model_unavailable', { status: 429, vendorCode: '1300' })],
        ['this plan does not include it (403)', fail('model_unavailable', { status: 403, vendorCode: '1910' })],
        ['its own rate limit is spent (429)', fail('rate_limited', { status: 429 })],
        ['it would not take the request (400)', fail('provider_request_rejected', { status: 400 })],
    ])('when %s', async (_label, error) => {
        vendors({ [`mistral/${FIRST}`]: error });

        const result = await runAiTask(readTask(), MISTRAL_FIRST);

        expect(asked()).toEqual([`mistral/${FIRST}`, `mistral/${SECOND}`]);
        expect(result).toMatchObject({ providerId: 'mistral', model: SECOND, fallbackCount: 0 });
    });

    it('switches on a rate limit at once, without sitting through the stated wait', async () => {
        vendors({ [`mistral/${FIRST}`]: fail('rate_limited', { status: 429, retryAfterMs: 20000 }) });
        const startedAt = Date.now();

        const result = await runAiTask(readTask(), MISTRAL_FIRST);

        expect(result.model).toBe(SECOND);
        expect(Date.now() - startedAt).toBeLessThan(1000);
    });

    it('tries each version once, then the next provider', async () => {
        vendors({ mistral: fail('model_unavailable', { status: 404 }) });

        const result = await runAiTask(readTask(), MISTRAL_FIRST);

        expect(asked()).toEqual([`mistral/${FIRST}`, `mistral/${SECOND}`, `mistral/${THIRD}`, 'groq/qwen/qwen3.8-27b']);
        expect(result).toMatchObject({ providerId: 'groq', fallbackCount: 1 });
    });
});

describe('a failure about the vendor or the account moves to the next provider', () => {
    it('leaves an overloaded vendor at once during a document read', async () => {
        // Its other versions are struggling too: Gemini's Lite version took
        // 13-16s while the Flash versions answered 503, against 1-2s on Groq.
        vendors({ [`mistral/${FIRST}`]: fail('provider_unavailable', { status: 503 }) });

        const result = await runAiTask(readTask(), MISTRAL_FIRST);

        expect(asked()).toEqual([`mistral/${FIRST}`, 'groq/qwen/qwen3.8-27b']);
        expect(result.providerId).toBe('groq');
    });

    it('tries an overloaded vendor\'s other versions when the work has the time', async () => {
        vendors({ 'gemini/gemini-3.6-flash': fail('provider_unavailable', { status: 503 }) });

        const result = await runAiTask(textTask());

        expect(asked()).toEqual(['gemini/gemini-3.6-flash', 'gemini/gemini-3.5-flash-lite']);
        expect(result).toMatchObject({ providerId: 'gemini', model: 'gemini-3.5-flash-lite' });
    });

    it.each([
        ['a timeout', fail('timeout')],
        ['a rejected key', fail('unauthorized', { status: 401 })],
        ['a spent allowance', fail('quota_exceeded', { status: 402 })],
        ['a network fault', fail('network')],
        ['an unreadable answer', fail('malformed_response')],
        ['an answer outside the schema', fail('schema_validation_failed')],
        ['an adapter bug', new TypeError('Cannot read properties of undefined')],
    ])('on %s', async (_label, error) => {
        vendors({ [`mistral/${FIRST}`]: error });

        const result = await runAiTask(readTask(), MISTRAL_FIRST);

        expect(asked()).toEqual([`mistral/${FIRST}`, 'groq/qwen/qwen3.8-27b']);
        expect(result.providerId).toBe('groq');
    });

    it('still ends the task on a task-fatal category, before any switch', async () => {
        vendors({ [`mistral/${FIRST}`]: fail('invalid_request') });

        await expect(runAiTask(readTask(), MISTRAL_FIRST)).rejects.toMatchObject({ category: 'invalid_request' });
        expect(asked()).toEqual([`mistral/${FIRST}`]);
    });
});

describe('a switch has to fit the task\'s budget', () => {
    /** Fails the first version after `elapsedMs` of a mocked clock. */
    async function failFirstVersionAfter(elapsedMs) {
        let now = Date.now();
        const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
        vendors({
            [`mistral/${FIRST}`]: () => {
                now += elapsedMs;
                throw fail('model_unavailable', { status: 404 });
            },
        });
        try {
            return await runAiTask(readTask(), MISTRAL_FIRST);
        } finally {
            clock.mockRestore();
        }
    }

    it('switches after a quick refusal, while the next version and a fallback both fit', async () => {
        // 45s total, 20s an attempt: 44s left holds a 20s attempt and a 20s fallback.
        const result = await failFirstVersionAfter(1000);
        expect(result.model).toBe(SECOND);
    });

    it('moves to the next provider when a switch would eat the fallback\'s time', async () => {
        // 39s left cannot hold both, so the next provider gets its full slice.
        const result = await failFirstVersionAfter(6000);
        expect(asked()).toEqual([`mistral/${FIRST}`, 'groq/qwen/qwen3.8-27b']);
        expect(result.providerId).toBe('groq');
    });

    it('keeps no slice back for a fallback when no provider after it can read', async () => {
        // The operator switched every other provider off: the same 39s hold
        // the next version, and nothing is left waiting for the time.
        const { PROVIDERS } = require('../../ai/registry/providers');
        mockStore.readAllConfigs.mockResolvedValue(allConfigured(Object.fromEntries(PROVIDERS
            .filter((provider) => provider.id !== 'mistral')
            .map((provider) => [provider.id, { enabled: false }]))));

        const result = await failFirstVersionAfter(6000);

        expect(asked()).toEqual([`mistral/${FIRST}`, `mistral/${SECOND}`]);
        expect(result.model).toBe(SECOND);
    });
});

describe('what the router records', () => {
    it('records the provider\'s outcome once a turn, as a success when a later version answered', async () => {
        vendors({ [`mistral/${FIRST}`]: fail('model_unavailable', { status: 404 }) });

        await runAiTask(readTask(), MISTRAL_FIRST);

        const mistralOutcomes = mockStore.recordProviderOutcome.mock.calls.filter(([id]) => id === 'mistral');
        expect(mistralOutcomes).toHaveLength(1);
        expect(mistralOutcomes[0][1]).toMatchObject({ success: true, lane: 'vision' });
    });

    it('records one failure, with the last version\'s category, when every version failed', async () => {
        vendors({
            [`mistral/${FIRST}`]: fail('model_unavailable', { status: 404 }),
            [`mistral/${SECOND}`]: fail('rate_limited', { status: 429 }),
            [`mistral/${THIRD}`]: fail('model_unavailable', { status: 429 }),
        });

        await runAiTask(readTask(), MISTRAL_FIRST);

        const mistralOutcomes = mockStore.recordProviderOutcome.mock.calls.filter(([id]) => id === 'mistral');
        expect(mistralOutcomes).toHaveLength(1);
        expect(mistralOutcomes[0][1]).toMatchObject({ success: false, category: 'model_unavailable', lane: 'vision' });
    });

    it('logs which version failed, which answered, and each provider once', async () => {
        vendors({ [`mistral/${FIRST}`]: fail('model_unavailable', { status: 404, vendorCode: 'model_not_found' }) });

        await runAiTask(readTask(), MISTRAL_FIRST);

        const entry = mockRecordTelemetry.mock.calls.at(-1)[0];
        expect(entry.attempts.map((attempt) => [attempt.model, attempt.success, attempt.nextProviderId])).toEqual([
            [FIRST, false, 'mistral'],
            [SECOND, true, null],
        ]);
        expect(entry.attempts[0]).toMatchObject({ httpStatus: 404, vendorCode: 'model_not_found' });
        expect(entry).toMatchObject({ providerId: 'mistral', model: SECOND, providersInvolved: ['mistral'] });
    });

    it('names each provider once in the trail of an exhausted walk', async () => {
        // The watcher reads this trail as `provider=category` pairs.
        const down = fail('provider_unavailable', { status: 503 });
        vendors({
            mistral: fail('model_unavailable', { status: 404 }), groq: down, gemini: down, openrouter: down, huggingface: down,
        });

        const error = await runAiTask(readTask(), MISTRAL_FIRST).catch((thrown) => thrown);

        expect(error.category).toBe('all_providers_failed');
        expect(error.detail).toContain('[mistral=model_unavailable, groq=provider_unavailable, gemini=provider_unavailable');
        const trail = error.detail.match(/\[(.*)\]/)[1].split(', ').map((pair) => pair.split('=')[0]);
        expect(new Set(trail).size).toBe(trail.length);
        expect(error.failureCategories[0]).toBe('model_unavailable');
    });
});

describe('versions the daily check saved', () => {
    // Checked against the built-in list this release ships.
    const withSaved = (vision) => allConfigured({ mistral: { modelLists: { vision: { models: vision, seed: [FIRST, SECOND, THIRD] } } } });

    it('are asked first, in their order, and the built-in ones not at all', async () => {
        mockStore.readAllConfigs.mockResolvedValue(withSaved([SECOND, 'mistral-small-2603']));
        vendors({ [`mistral/${SECOND}`]: fail('model_unavailable', { status: 404 }) });

        await runAiTask(readTask(), MISTRAL_FIRST);

        expect(asked()).toEqual([`mistral/${SECOND}`, 'mistral/mistral-small-2603']);
    });

    it('rest like any other version', async () => {
        mockStore.readAllConfigs.mockResolvedValue(withSaved([SECOND, 'mistral-small-2603']));
        vendors({ [`mistral/${SECOND}`]: fail('model_unavailable', { status: 404 }) });

        await runAiTask(readTask(), MISTRAL_FIRST);

        const outcome = mockStore.recordProviderOutcome.mock.calls.find(([id]) => id === 'mistral')[1];
        expect(outcome.versionRests).toEqual([expect.objectContaining({ model: SECOND, reason: 'removed' })]);
    });

    it('fall back to the built-in list when the stored one is unusable', async () => {
        mockStore.readAllConfigs.mockResolvedValue(withSaved(['not a model id']));
        vendors({});

        await runAiTask(readTask(), MISTRAL_FIRST);

        expect(asked()).toEqual([`mistral/${FIRST}`]);
    });

    it('give way at once to a release that changed the lane\'s built-in list', async () => {
        // Saved against an older release's versions, before this one re-pinned them.
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({
            mistral: { modelLists: { vision: { models: ['mistral-small-2603'], seed: ['mistral-medium-latest'] } } },
        }));
        vendors({});

        await runAiTask(readTask(), MISTRAL_FIRST);

        expect(asked()).toEqual([`mistral/${FIRST}`]);
    });
});
