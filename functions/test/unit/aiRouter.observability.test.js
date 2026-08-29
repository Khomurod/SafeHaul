/**
 * What a run records: the answer it kept, the shape it validated, the telemetry
 * it sends, and the transaction log.
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

const { runAiTask, SKIP_REASONS } = require('../../ai/router/router');
const { AiError } = require('../../ai/router/errors');
const { CAPABILITIES } = require('../../ai/registry/capabilities');
const { TASK_TYPES, PRIVACY, defineTask } = require('../../ai/tasks/contract');
const {
    mockRecordTelemetry, mockStore, mockExecute, allConfigured, textTask, visionTask,
    resetAiRouterState,
} = require('./aiRouter.support');

beforeEach(resetAiRouterState);

/**
 * "A provider answered in a valid shape" and "the answer was the one we wanted"
 * are different facts, and for the article fact-check they are opposite ones: a
 * verdict of `supported: false` is a valid payload, so the transaction is a
 * success and the article is correctly refused. The Logs tab showed
 * `article_generation: Success` and `article_fact_check: Success` for a run that
 * published nothing.
 */
describe('a task can record what its answer said', () => {
    const { safeVerdict } = require('../../ai/router/router').__test;

    it('records the verdict alongside the successful outcome', async () => {
        const task = defineTask({
            taskType: TASK_TYPES.ARTICLE_FACT_CHECK,
            capabilities: [CAPABILITIES.TEXT, CAPABILITIES.STRUCTURED_JSON],
            inputText: 'Check this.',
            outputSchema: {
                type: 'object',
                properties: { supported: { type: 'boolean' } },
                required: ['supported'],
                additionalProperties: false,
            },
            verdictOf: (output) => (output.supported ? 'supported' : 'unsupported'),
        });
        mockExecute.mockResolvedValue({ text: '{"supported":false}', model: 'm' });

        await runAiTask(task);

        const recorded = mockRecordTelemetry.mock.calls
            .map(([entry]) => entry)
            .find((entry) => entry.outcome === 'success');
        expect(recorded.verdict).toBe('unsupported');
    });

    it('drops anything that is not a short single word', () => {
        // The reducer is supplied by the task, so this is what makes it
        // impossible for one to hand telemetry an article, a claim or a source.
        expect(safeVerdict({ verdictOf: () => 'supported' }, {})).toBe('supported');
        expect(safeVerdict({ verdictOf: () => 'The rule takes effect in 2027' }, {})).toBeNull();
        expect(safeVerdict({ verdictOf: () => 'x'.repeat(40) }, {})).toBeNull();
        expect(safeVerdict({ verdictOf: () => ({ supported: false }) }, {})).toBeNull();
        expect(safeVerdict({}, {})).toBeNull();
    });

    it('never lets a throwing reducer fail the task it describes', () => {
        expect(safeVerdict({ verdictOf: () => { throw new Error('boom'); } }, {})).toBeNull();
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

