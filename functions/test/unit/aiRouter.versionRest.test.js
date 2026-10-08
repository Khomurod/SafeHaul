/**
 * Version rests and vendor-stated waits: how long a failed version rests,
 * that the next request starts on one that works, and that a document read
 * does not sit through a long wait.
 *
 * Part of the `aiRouter` suite. The provider fakes, the credential and config
 * doubles, the task builders and the reset are in `aiRouter.support.js`. Each
 * `jest.mock` below has to stay in this file, because Jest hoists it per file
 * and cannot register one from a helper. The switching rules themselves are in
 * aiRouter.versions.
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
    REMOVED_REST_MS, SLOW_REST_MS, RATE_LIMIT_REST_MIN_MS, RATE_LIMIT_REST_MAX_MS,
} = require('../../ai/router/versionPolicy');
const {
    mockStore, mockExecute, allConfigured, resetAiRouterState,
} = require('./aiRouter.support');

const MISTRAL_FIRST = { providerOrder: ['mistral', 'groq'] };
const [FIRST, SECOND, THIRD] = ['ministral-14b-2512', 'ministral-8b-2512', 'mistral-medium-latest'];

function readTask(extra = {}) {
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
        ...extra,
    });
}

/** The same shape as a document read, on the text lane. */
function textReadTask() {
    return defineTask({
        taskType: TASK_TYPES.APPLICATION_DOCUMENT_EXTRACTION,
        capabilities: [CAPABILITIES.STRUCTURED_JSON],
        inputText: 'DRIVER LICENSE TX 1234567',
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

function vendors(script) {
    mockExecute.mockImplementation(async (providerId, context) => {
        const outcome = script[`${providerId}/${context.model}`] ?? script[providerId];
        if (typeof outcome === 'function') return outcome(context);
        if (outcome) throw outcome;
        return { text: '{"value":"x"}', model: context.model };
    });
}

const fail = (category, extra = {}) => new AiError(category, `HTTP ${extra.status || 0}`, extra);

// Every vendor answers a read correctly unless a test scripts otherwise.
beforeEach(() => {
    resetAiRouterState();
    vendors({});
});

function asked() {
    return mockExecute.mock.calls.map(([providerId, context]) => `${providerId}/${context.model}`);
}

/** Mistral's recorded outcome for this task. */
function mistralOutcome() {
    return mockStore.recordProviderOutcome.mock.calls.find(([id]) => id === 'mistral')[1];
}

/** A stored rest entry, keyed the way the store keys it. */
function restEntry(model, until, lane = 'vision') {
    const { versionRestKey } = jest.requireActual('../../ai/credentials/health');
    return { [versionRestKey(lane, model)]: { model, lane, until, reason: 'removed' } };
}

describe('how long a failed version rests', () => {
    it('rests a withdrawn version for a day', async () => {
        vendors({ [`mistral/${FIRST}`]: fail('model_unavailable', { status: 404 }) });
        const before = Date.now();

        await runAiTask(readTask(), MISTRAL_FIRST);

        const [rest] = mistralOutcome().versionRests;
        expect(rest).toMatchObject({ model: FIRST, reason: 'removed' });
        expect(rest.until - before).toBeGreaterThanOrEqual(REMOVED_REST_MS);
        expect(rest.until - Date.now()).toBeLessThanOrEqual(REMOVED_REST_MS);
    });

    it.each([
        ['the vendor\'s stated wait', 2 * 60 * 1000, 2 * 60 * 1000],
        ['a minute when the vendor said nothing', undefined, RATE_LIMIT_REST_MIN_MS],
        ['at most ten minutes', 45 * 60 * 1000, RATE_LIMIT_REST_MAX_MS],
    ])('rests a rate-limited version for %s', async (_label, retryAfterHintMs, expectedMs) => {
        vendors({ [`mistral/${FIRST}`]: fail('rate_limited', { status: 429, retryAfterHintMs }) });
        const before = Date.now();

        await runAiTask(readTask(), MISTRAL_FIRST);

        const [rest] = mistralOutcome().versionRests;
        expect(rest.reason).toBe('rate_limited');
        expect(rest.until - before).toBeGreaterThanOrEqual(expectedMs);
        expect(rest.until - Date.now()).toBeLessThanOrEqual(expectedMs);
    });

    it('rests a version that spent its whole slice without answering', async () => {
        vendors({ [`mistral/${FIRST}`]: fail('timeout') });

        await runAiTask(readTask(), MISTRAL_FIRST);

        expect(mistralOutcome().versionRests).toEqual([
            expect.objectContaining({ model: FIRST, reason: 'slow' }),
        ]);
        expect(mistralOutcome().versionRests[0].until - Date.now()).toBeLessThanOrEqual(SLOW_REST_MS);
    });

    it('does not rest a version whose attempt was cut short by the task\'s deadline', async () => {
        // A late attempt ran out of the task's budget, not of its own time.
        let now = Date.now();
        const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
        vendors({
            gemini: () => {
                now += 30000;
                throw fail('provider_unavailable', { status: 503 });
            },
            [`mistral/${FIRST}`]: (context) => {
                expect(context.timeoutMs).toBeLessThan(20000);
                throw fail('timeout');
            },
        });
        try {
            await runAiTask(readTask(), { providerOrder: ['gemini', 'mistral', 'groq'] });
        } finally {
            clock.mockRestore();
        }

        expect(mistralOutcome().versionRests).toBeUndefined();
    });

    it('does not rest a version that answered on its retry', async () => {
        // No time to switch, so the vendor's short wait is served and the same
        // version answers: it must not be benched for the next request.
        let now = Date.now();
        const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
        let firstCalls = 0;
        vendors({
            [`mistral/${FIRST}`]: () => {
                firstCalls += 1;
                if (firstCalls > 1) return { text: '{"value":"x"}', model: FIRST };
                now += 6000;
                throw fail('rate_limited', { status: 429, retryAfterMs: 5 });
            },
        });
        try {
            const result = await runAiTask(readTask(), MISTRAL_FIRST);
            expect(result.model).toBe(FIRST);
        } finally {
            clock.mockRestore();
        }

        expect(firstCalls).toBe(2);
        expect(mistralOutcome()).toEqual({ success: true, lane: 'vision' });
    });

    it('does not rest a version over a request it would not take', async () => {
        vendors({ [`mistral/${FIRST}`]: fail('provider_request_rejected', { status: 400 }) });

        await runAiTask(readTask(), MISTRAL_FIRST);

        expect(mistralOutcome()).toEqual({ success: true, lane: 'vision' });
    });

    it('rests nothing in a lane with one version, where there is nothing to prefer', async () => {
        vendors({ groq: fail('model_unavailable', { status: 404 }) });

        await runAiTask(readTask(), { providerOrder: ['groq', 'mistral'] });

        const groqOutcome = mockStore.recordProviderOutcome.mock.calls.find(([id]) => id === 'groq')[1];
        expect(groqOutcome).toEqual({
            success: false, category: 'model_unavailable', lane: 'vision', retryAfterHintMs: null,
        });
    });
});

describe('the next request starts on a version that works', () => {
    it('skips a resting version', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({
            mistral: { versionRest: restEntry(FIRST, Date.now() + 60000) },
        }));

        const result = await runAiTask(readTask(), MISTRAL_FIRST);

        expect(asked()).toEqual([`mistral/${SECOND}`]);
        expect(result.model).toBe(SECOND);
    });

    it('rests only in the lane the version failed in', async () => {
        // A rest from a photo read leaves the same model's text lane alone.
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({
            mistral: { versionRest: restEntry(FIRST, Date.now() + 60000, 'vision') },
        }));

        await runAiTask(textReadTask(), MISTRAL_FIRST);

        expect(asked()).toEqual([`mistral/${FIRST}`]);
    });

    it('uses a version again once its rest has passed', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({
            mistral: { versionRest: restEntry(FIRST, Date.now() - 1000) },
        }));

        await runAiTask(readTask(), MISTRAL_FIRST);

        expect(asked()).toEqual([`mistral/${FIRST}`]);
    });

    it('tries every version, soonest-recovering first, when all of them rest', async () => {
        // A rest is a preference, never a gate: the provider is never shut out
        // by its rests alone, and a version gone for a day comes last.
        const now = Date.now();
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({
            mistral: {
                versionRest: {
                    ...restEntry(FIRST, now + 60000),
                    ...restEntry(SECOND, now + 30000),
                    ...restEntry(THIRD, now + 24 * 60 * 60 * 1000),
                },
            },
        }));
        vendors({ [`mistral/${SECOND}`]: fail('model_unavailable', { status: 404 }) });

        const result = await runAiTask(readTask(), MISTRAL_FIRST);

        expect(asked()).toEqual([`mistral/${SECOND}`, `mistral/${FIRST}`]);
        expect(result.model).toBe(FIRST);
        // The version that answered has proved itself, so its rest is cleared.
        expect(mistralOutcome()).toMatchObject({ success: true, clearRestFor: FIRST });
    });

    it('treats an operator\'s model override as the only version', async () => {
        vendors({ openrouter: fail('model_unavailable', { status: 404 }) });

        await runAiTask(readTask(), { providerOrder: ['openrouter', 'groq'] });

        expect(asked()).toEqual(['openrouter/test/vision-model', 'groq/qwen/qwen3.8-27b']);
    });
});

describe('a document read does not sit through a long stated wait', () => {
    it('asks the next provider at once when the wait is longer than five seconds', async () => {
        // Groq's only photo model has no spare version to switch to.
        vendors({ groq: fail('rate_limited', { status: 429, retryAfterMs: 7000 }) });
        const startedAt = Date.now();

        const result = await runAiTask(readTask(), { providerOrder: ['groq', 'mistral'] });

        expect(asked()).toEqual(['groq/qwen/qwen3.8-27b', `mistral/${FIRST}`]);
        expect(result.providerId).toBe('mistral');
        expect(Date.now() - startedAt).toBeLessThan(1000);
        // Groq's turn looked ahead to Mistral; the walk did not ask again.
        expect(mockStore.resolveCredentials.mock.calls.filter(([id]) => id === 'mistral')).toHaveLength(1);
    });

    it('still waits out a pause of five seconds or less', async () => {
        let groqCalls = 0;
        vendors({
            groq: () => {
                groqCalls += 1;
                if (groqCalls === 1) throw fail('rate_limited', { status: 429, retryAfterMs: 5 });
                return { text: '{"value":"x"}', model: 'qwen/qwen3.8-27b' };
            },
        });

        const result = await runAiTask(readTask(), { providerOrder: ['groq', 'mistral'] });

        expect(groqCalls).toBe(2);
        expect(result.providerId).toBe('groq');
    });

    it('does not let a provider\'s own retry sit through the wait either', async () => {
        // Hugging Face's registry row allows one retry, and that retry waited
        // the vendor's stated pause in place.
        vendors({ huggingface: fail('rate_limited', { status: 429, retryAfterMs: 10000 }) });
        const startedAt = Date.now();

        const result = await runAiTask(textReadTask(), { providerOrder: ['huggingface', 'groq'] });

        expect(asked().filter((call) => call.startsWith('huggingface/'))).toHaveLength(1);
        expect(result.providerId).toBe('groq');
        expect(Date.now() - startedAt).toBeLessThan(1000);
    });
});

describe('unless no provider after it can read', () => {
    // Moving on only helps when someone can be asked next. With nobody, it
    // turned a seven-second pause into a failed read.
    afterEach(() => jest.useRealTimers());

    /** Every provider but these switched off by the operator. */
    function onlyEnabled(ids, overrides = {}) {
        const { PROVIDERS } = require('../../ai/registry/providers');
        return allConfigured(Object.fromEntries(PROVIDERS.map((provider) => [
            provider.id, ids.includes(provider.id) ? overrides[provider.id] || {} : { enabled: false },
        ])));
    }

    /** Fails the first call with a stated wait, answers the next; returns each call's time. */
    function pauseOnce(providerId, retryAfterMs) {
        const calls = [];
        vendors({
            [providerId]: (context) => {
                calls.push(Date.now());
                if (calls.length === 1) throw fail('rate_limited', { status: 429, retryAfterMs });
                return { text: '{"value":"x"}', model: context.model };
            },
        });
        return calls;
    }

    /** Runs the task through one stated pause of `ms`, on a fake clock. */
    async function runThroughPause(task, providerOrder, ms) {
        jest.useFakeTimers();
        const pending = runAiTask(task, { providerOrder });
        await jest.advanceTimersByTimeAsync(ms);
        return pending;
    }

    it.each([
        ['a pause of its own', 'groq', readTask, 7000],
        ['its own retry', 'huggingface', textReadTask, 10000],
    ])('waits out the vendor\'s stated pause, on %s', async (_label, providerId, task, ms) => {
        mockStore.readAllConfigs.mockResolvedValue(onlyEnabled([providerId]));
        const calls = pauseOnce(providerId, ms);

        const result = await runThroughPause(task(), [providerId], ms);

        expect(result.providerId).toBe(providerId);
        expect(calls).toHaveLength(2);
        expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(ms);
    });

    it('counts a provider after it only when that one could read now', async () => {
        // Mistral is enabled and next in line, but cooling down in this lane.
        mockStore.readAllConfigs.mockResolvedValue(onlyEnabled(['groq', 'mistral'], {
            mistral: { laneCooldownUntil_vision: Date.now() + 60000 },
        }));
        pauseOnce('groq', 7000);

        const result = await runThroughPause(readTask(), ['groq', 'mistral'], 7000);

        expect(result.providerId).toBe('groq');
        expect(asked()).toEqual(['groq/qwen/qwen3.8-27b', 'groq/qwen/qwen3.8-27b']);
    });

    it.each([
        ['a pause of its own', 'groq', readTask],
        ['its own retry', 'huggingface', textReadTask],
    ])('still does not wait when %s would not leave a full attempt after it', async (_label, providerId, task) => {
        // 45s in all and 20s an attempt: after 30s, only 15s would be left.
        mockStore.readAllConfigs.mockResolvedValue(onlyEnabled([providerId]));
        pauseOnce(providerId, 30000);
        const startedAt = Date.now();

        await expect(runAiTask(task(), { providerOrder: [providerId] })).rejects.toMatchObject({
            category: 'all_providers_failed', failureCategories: ['rate_limited'],
        });

        expect(asked()).toHaveLength(1);
        expect(Date.now() - startedAt).toBeLessThan(1000);
    });
});
