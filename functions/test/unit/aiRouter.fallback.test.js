/**
 * Credentials that cannot be read, and what makes the router fall through to
 * the next provider.
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
const { PROVIDERS } = require('../../ai/registry/providers');
const {
    mockStore, mockExecute, textTask, visionTask, resetAiRouterState,
} = require('./aiRouter.support');

beforeEach(resetAiRouterState);

/**
 * The reported symptom, at its source.
 *
 * A driver saw "AI auto-fill is not configured on the server." while nine
 * providers sat correctly configured in Secret Manager. `cdlParser.js` produces
 * that sentence from the `not_configured` category, and `buildTerminalFailure`
 * produced `not_configured` for a walk in which every provider was skipped
 * because its credential could not be READ — an IAM fault on SafeHaul's side,
 * reported as an absence of configuration.
 *
 * The two need opposite operator actions, so they are now different categories.
 */
describe('unreadable credentials are reported as such, not as unconfigured', () => {
    const unreadable = {
        complete: false,
        values: {},
        missing: [],
        unreadable: ['apiKey'],
        source: null,
    };

    it('reports credential_error when every provider credential is unreadable', async () => {
        mockStore.resolveCredentials.mockResolvedValue(unreadable);

        await expect(runAiTask(textTask())).rejects.toMatchObject({ category: 'credential_error' });
        expect(mockExecute).not.toHaveBeenCalled();
    });

    /**
     * `some`, not `every`. A vision task legitimately skips the text-only
     * providers as `incapable`, so a rule requiring *every* skip to be a
     * credential error would never fire on the CDL path — the exact path that
     * reported the symptom.
     */
    it('reports credential_error even when incapable providers are skipped alongside', async () => {
        mockStore.resolveCredentials.mockResolvedValue(unreadable);

        await expect(runAiTask(visionTask())).rejects.toMatchObject({ category: 'credential_error' });
    });

    it('still reports not_configured when the credential is genuinely absent', async () => {
        mockStore.resolveCredentials.mockResolvedValue({
            complete: false, values: {}, missing: ['apiKey'], unreadable: [], source: null,
        });

        await expect(runAiTask(textTask())).rejects.toMatchObject({ category: 'not_configured' });
    });

    it('names the affected providers for an operator without naming a secret', async () => {
        mockStore.resolveCredentials.mockResolvedValue(unreadable);

        const error = await runAiTask(textTask()).catch((err) => err);

        expect(error.detail).toMatch(/gemini/);
        // A detail line is for server logs and the console, so it may name a
        // provider — but never a resource, a project or a credential.
        expect(error.detail).not.toMatch(/SAFEHAUL_AI_/);
        expect(error.detail).not.toMatch(/projects\//);
    });

    it('skips the provider rather than failing the task when only one is unreadable', async () => {
        mockStore.resolveCredentials.mockImplementation(async (providerId) => (
            providerId === 'gemini'
                ? unreadable
                : { complete: true, values: { apiKey: 'k' }, missing: [], unreadable: [], source: 'secret-manager' }
        ));

        const result = await runAiTask(textTask());

        expect(result.providerId).toBe('groq');
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
            // Which lane failed, so a rejected document image cannot count
            // against — or cool down — this provider's article writing.
            lane: 'text',
            // Null here because this vendor stated no wait. When one is stated
            // it sizes the cooldown, so a per-minute cap costs a minute rather
            // than the flat half hour a spent daily allowance deserves.
            retryAfterHintMs: null,
        });
    });

    it('passes the vendor stated wait through so the cooldown can be sized to it', async () => {
        mockExecute.mockImplementation(async (providerId) => {
            if (providerId === 'gemini') {
                throw new AiError('rate_limited', '429', { providerId, retryAfterHintMs: 44268 });
            }
            return { text: 'ok', model: 'g' };
        });

        await runAiTask(textTask());

        expect(mockStore.recordProviderOutcome).toHaveBeenCalledWith('gemini', {
            success: false,
            category: 'rate_limited',
            lane: 'text',
            retryAfterHintMs: 44268,
        });
    });
});
