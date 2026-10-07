/**
 * Infrastructure failures, images rejected before any provider is tried,
 * deadlines, and `describeRouting`.
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

const { runAiTask, describeRouting, SKIP_REASONS } = require('../../ai/router/router');
const { AiError } = require('../../ai/router/errors');
const { CAPABILITIES } = require('../../ai/registry/capabilities');
const { TASK_TYPES, PRIVACY, defineTask } = require('../../ai/tasks/contract');
const {
    mockRecordTelemetry, mockStore, mockExecute, allConfigured, textTask,
    resetAiRouterState,
} = require('./aiRouter.support');

beforeEach(resetAiRouterState);

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

    it('falls back to the last known config when Firestore has a bad minute', async () => {
        // Warm instance: it read config successfully once, so a later failure
        // must not discard what the operator decided.
        mockStore.readAllConfigs.mockResolvedValueOnce(allConfigured());
        await runAiTask(textTask());

        mockStore.readAllConfigs.mockRejectedValue(new Error('firestore unavailable'));
        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('gemini');
    });

    it('never re-enables a provider an operator disabled, even during a config outage', async () => {
        // The first version of this returned an empty map on failure, and empty
        // config reads as `{ enabled: true }` — silently re-enabling every
        // disabled provider. `setAiProviderEnabled` promises the opposite, and a
        // provider is sometimes disabled precisely because it is mishandling
        // data, on paths carrying restricted CDL and document images.
        mockStore.readAllConfigs.mockResolvedValueOnce(allConfigured({ gemini: { enabled: false } }));
        await runAiTask(textTask());

        mockStore.readAllConfigs.mockRejectedValue(new Error('firestore unavailable'));
        const result = await runAiTask(textTask());

        expect(result.providerId).not.toBe('gemini');
        expect(mockExecute.mock.calls.map((call) => call[0])).not.toContain('gemini');
    });

    it('refuses to route at all when config is unreadable and nothing is cached', async () => {
        // A cold instance cannot know which providers are disabled. Refusing is
        // the safe direction, and it is still a categorised failure with
        // telemetry rather than the uncaught throw this replaced.
        jest.resetModules();
        const isolated = require('../../ai/router/router');
        mockStore.readAllConfigs.mockRejectedValue(new Error('firestore unavailable'));

        await expect(isolated.runAiTask(textTask())).rejects.toMatchObject({ category: 'not_configured' });
        expect(mockExecute).not.toHaveBeenCalled();
        expect(mockRecordTelemetry).toHaveBeenCalledWith(
            expect.objectContaining({ outcome: 'failure' }),
        );
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

describe('what a failed task means to the person who asked', () => {
    const { failureKind } = require('../../ai/router/errors');
    const terminal = (fields) => require('../../ai/router/router').__test.buildTerminalFailure({
        attempted: [], skipped: [], lastError: null, failures: [], ...fields,
    });

    it('reports every capable provider resting as unavailable, not as unconfigured', () => {
        const failure = terminal({
            skipped: [
                { providerId: 'gemini', reason: SKIP_REASONS.COOLDOWN },
                { providerId: 'mistral', reason: SKIP_REASONS.COOLDOWN },
                { providerId: 'cerebras', reason: SKIP_REASONS.INCAPABLE },
            ],
        });
        expect(failure.category).toBe('provider_unavailable');
        expect(failureKind(failure)).toBe('unavailable');
    });

    it('still reports nothing configured as a configuration gap', () => {
        const failure = terminal({ skipped: [{ providerId: 'gemini', reason: SKIP_REASONS.UNCONFIGURED }] });
        expect(failure.category).toBe('not_configured');
        expect(failureKind(failure)).toBe('not_configured');
    });

    it('keeps each provider\'s failure on an exhausted walk, and reads outages as unavailable', () => {
        const failure = terminal({
            attempted: ['gemini', 'groq'],
            lastError: new AiError('quota_exceeded', 'spent'),
            failures: [{ providerId: 'gemini', category: 'timeout' }, { providerId: 'groq', category: 'quota_exceeded' }],
        });
        expect(failure.category).toBe('all_providers_failed');
        expect(failure.failureCategories).toEqual(['timeout', 'quota_exceeded']);
        expect(failureKind(failure)).toBe('unavailable');
    });

    it('reads a walk where every provider answered unusably as unreadable', () => {
        const failure = terminal({
            attempted: ['gemini', 'groq'],
            lastError: new AiError('malformed_response', 'prose'),
            failures: [
                { providerId: 'gemini', category: 'schema_validation_failed' },
                { providerId: 'groq', category: 'malformed_response' },
            ],
        });
        expect(failureKind(failure)).toBe('unreadable');
    });

    it('reads a mixed walk as unavailable, since a provider that did not answer might have', () => {
        const failure = terminal({
            attempted: ['gemini', 'groq'],
            lastError: new AiError('timeout', 'slow'),
            failures: [
                { providerId: 'gemini', category: 'schema_validation_failed' },
                { providerId: 'groq', category: 'timeout' },
            ],
        });
        expect(failureKind(failure)).toBe('unavailable');
    });

    it('reads a SafeHaul fault as neither an outage nor the document', () => {
        expect(failureKind(new AiError('internal', 'TypeError'))).toBe('failed');
        expect(failureKind(new Error('no category'))).toBe('failed');
        expect(failureKind(undefined)).toBe('failed');
        // Every adapter threw, or every vendor refused the request: waiting will
        // not fix that. One outage on the trail still might.
        const walk = (...categories) => terminal({
            attempted: categories.map((_, index) => `p${index}`),
            lastError: new AiError(categories[0], 'x'),
            failures: categories.map((category, index) => ({ providerId: `p${index}`, category })),
        });
        expect(failureKind(walk('internal', 'internal'))).toBe('failed');
        expect(failureKind(walk('provider_request_rejected', 'internal'))).toBe('failed');
        expect(failureKind(walk('internal', 'timeout'))).toBe('unavailable');
    });
});

describe('a per-attempt deadline lets a task fail over before the total runs out', () => {
    /**
     * The defect: every provider's `timeoutMs` equalled the task's total, so the
     * FIRST provider could consume the whole budget. When it stalled, `http.js`
     * threw `deadline_exceeded` (the total-deadline abort) — which `isTaskFatal`
     * ends the walk on — instead of the per-attempt `timeout`, which fails over.
     * A rate-limited provider at the top of the routing order therefore timed out
     * the entire read (observed in production as `deadline_exceeded` at ~47s).
     *
     * The fix caps each attempt to `perAttemptDeadlineMs`, so a stalled provider
     * throws the non-fatal `timeout` with budget left to reach a healthy one.
     */
    it('caps each attempt to the per-attempt deadline, so a stalled leader fails over', async () => {
        mockExecute.mockImplementation(async (providerId, context) => {
            if (providerId === 'gemini') {
                // What `http.js` throws when the PER-ATTEMPT timer fires — not the
                // total-deadline abort, which would be the fatal `deadline_exceeded`.
                throw new AiError('timeout', `No response within ${context.timeoutMs}ms.`, { providerId });
            }
            return { text: 'ok', model: 'test/model' };
        });

        const result = await runAiTask(textTask({ totalDeadlineMs: 45000, perAttemptDeadlineMs: 20000 }));

        // Gemini leads by default and stalled; the read still succeeds via groq.
        expect(result.providerId).toBe('groq');
        // Gemini was handed only the 20s slice — min(provider 45000, cap 20000,
        // remaining). That smaller cap is precisely what leaves time to reach groq.
        const geminiCall = mockExecute.mock.calls.find(([id]) => id === 'gemini');
        expect(geminiCall[1].timeoutMs).toBe(20000);
    });

    it('is opt-in: a task with no per-attempt cap still hands the attempt the whole budget', async () => {
        const result = await runAiTask(textTask({ totalDeadlineMs: 45000 }));

        expect(result.providerId).toBeTruthy();
        const firstCall = mockExecute.mock.calls[0];
        // Capped only by the remaining budget, never below it — the old behaviour,
        // proving the new term changes nothing until a task asks for it.
        expect(firstCall[1].timeoutMs).toBeGreaterThan(20000);
        expect(firstCall[1].timeoutMs).toBeLessThanOrEqual(45000);
    });

    it('does not retry a stalled provider into the time kept for the next one', async () => {
        // Hugging Face is the provider whose policy allows a retry. Placed first
        // by an operator, a stall spent two ceilings (20s + 0.75s + 20s of 45s)
        // and left the next provider almost nothing. Each attempt here advances
        // the clock by its whole ceiling, as a stall does.
        let now = Date.now();
        const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
        mockExecute.mockImplementation(async (providerId, context) => {
            if (providerId === 'huggingface') {
                now += context.timeoutMs;
                throw new AiError('timeout', `No response within ${context.timeoutMs}ms.`, { providerId });
            }
            return { text: 'ok', model: 'test/model' };
        });

        try {
            const result = await runAiTask(
                textTask({ totalDeadlineMs: 45000, perAttemptDeadlineMs: 20000 }),
                { providerOrder: ['huggingface', 'groq'] },
            );

            expect(result.providerId).toBe('groq');
            expect(mockExecute.mock.calls.filter(([id]) => id === 'huggingface')).toHaveLength(1);
        } finally {
            clock.mockRestore();
        }
    });

    it('still retries a provider that failed fast, when the reserve allows it', async () => {
        let huggingfaceCalls = 0;
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'huggingface' && (huggingfaceCalls += 1) === 1) {
                throw new AiError('provider_unavailable', 'HTTP 503', { providerId });
            }
            return { text: 'ok', model: 'test/model' };
        });

        const result = await runAiTask(
            textTask({ totalDeadlineMs: 45000, perAttemptDeadlineMs: 20000 }),
            { providerOrder: ['huggingface', 'groq'] },
        );

        expect(result.providerId).toBe('huggingface');
        expect(huggingfaceCalls).toBe(2);
    });

    it('will not honour a stated retry wait that would consume the failover reserve', async () => {
        const { AiError } = require('../../ai/router/errors');
        // Gemini asks for a 30s wait (the max) — honouring it under a 20s ceiling
        // against a 45s total would leave no room for a fallback attempt.
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'gemini') {
                const error = new AiError('timeout', 'Rate limited.', { providerId });
                error.retryable = true;
                error.retryAfterMs = 30000;
                throw error;
            }
            return { text: 'ok', model: 'test/model' };
        });

        const result = await runAiTask(textTask({ totalDeadlineMs: 45000, perAttemptDeadlineMs: 20000 }));

        // Skipped the wait and failed straight over — and never slept 30s.
        expect(result.providerId).toBe('groq');
        expect(mockExecute.mock.calls.filter(([id]) => id === 'gemini')).toHaveLength(1);
    });
});

describe('describeRouting', () => {
    it('explains why each provider is or is not eligible', async () => {
        mockStore.readAllConfigs.mockResolvedValue(allConfigured({ gemini: { enabled: false } }));

        const rows = await describeRouting([CAPABILITIES.VISION]);
        const byId = Object.fromEntries(rows.map((row) => [row.providerId, row]));

        // Groq is eligible for vision, on `qwen/qwen3.8-27b`. The console
        // must show the model it would actually use, so an operator deciding
        // the order can see what each lane resolves to.
        expect(byId.groq).toMatchObject({ eligible: true, model: 'qwen/qwen3.8-27b' });
        expect(byId.gemini).toMatchObject({ eligible: false, reason: SKIP_REASONS.DISABLED });
        expect(byId.cerebras).toMatchObject({ eligible: false, reason: SKIP_REASONS.INCAPABLE });
        expect(byId['github-models']).toMatchObject({ eligible: false, reason: SKIP_REASONS.RETIRED });
    });
});
