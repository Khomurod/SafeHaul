/**
 * The capability-aware AI router.
 *
 * Every AI request in SafeHaul goes through `runAiTask`. It walks the provider
 * order, skipping providers that cannot or should not serve this request, and
 * returns the first response that survives validation.
 *
 * The order is the registry's `priority` unless a Super Admin has stored an
 * override in `ai_routing_config/order`; see ./order.js, which degrades to the
 * registry order rather than disabling AI if that document is absent or
 * corrupt. Ordering is applied *before* eligibility, so nothing below changes:
 * promoting a provider cannot make it serve a task it is not capable of.
 *
 * The rules it enforces, in the order it enforces them:
 *
 *  1. **Capability is a gate, not a preference.** A provider that has not
 *     declared `vision` never receives an image, so a CDL photograph cannot
 *     reach a text-only vendor by accident or by misconfiguration.
 *  2. **Try each compatible provider once**, in the effective order, until
 *     one produces a response that passes schema validation.
 *  3. **One provider's failure is not the task's failure.** A timeout, an
 *     outage, an exhausted quota, malformed JSON, a rejected credential or an
 *     unexpected adapter exception all move to the next provider. Only a
 *     genuinely task-fatal category stops the walk — a malformed SafeHaul
 *     request, no capable provider, or the deadline — because those would get
 *     the same answer from all nine. See `isTaskFatal` in ./errors.js.
 *  4. **Bounded everywhere.** Per-provider timeout, a total request deadline,
 *     one attempt per provider unless the registry marks a retry safe, and a
 *     persisted cooldown so an exhausted provider is skipped rather than
 *     rediscovered by every cold instance.
 *  5. **Never fabricate.** If every compatible provider fails, the caller gets
 *     a safe error. There is no synthesized answer.
 */

// The pieces this loop decides with live beside it, one module per concern.
// `runAiTask` itself stays here whole: it is one control flow with a deadline
// spanning every fallback, and cutting it into phases would mean threading that
// shared state through arguments — a refactor of the routing path, which is a
// different decision from a size split and is deliberately not made here.

const { CAPABILITIES, normalizeCapabilities, laneForCapability } = require('../registry/capabilities');
const { getAdapter } = require('../providers');
const { AiError, isTaskFatal } = require('./errors');
const store = require('../credentials/store');
const {
    recordAiTelemetry, describeTaskInput, MAX_ATTEMPTS: MAX_RECORDED_ATTEMPTS,
} = require('../telemetry/record');
const { randomUUID } = require('crypto');

/** Ceiling on how long a whole task may take, across every fallback. */
const DEFAULT_TOTAL_DEADLINE_MS = 120000;
const {
    SKIP_REASONS, evaluateProvider, safeEvaluateProvider, pickPrimaryCapability,
} = require('./eligibility');
const { resolveConfigs, resolveProviderOrder } = require('./configs');
const { assertImagesAreWellFormed, normalizeOutput, safeVerdict, sleep } = require('./output');
const { buildTerminalFailure, finishFailure } = require('./failure');
/**
 * Runs one AI task through the router.
 *
 * @param {object} task normalized task contract (see ../tasks/contract.js)
 * @param {object} [deps] injection seam:
 *   `{ client, fetchImpl, now, providers, providerOrder }`
 * @returns {Promise<{ output: *, providerId: string, model: string, latencyMs: number,
 *   fallbackCount: number, credentialSource: string }>}
 */
async function runAiTask(task, deps = {}) {
    const startedAt = Date.now();
    const capabilities = normalizeCapabilities(task.capabilities);
    const primaryCapability = pickPrimaryCapability(capabilities);
    const hasImages = Array.isArray(task.images) && task.images.length > 0;

    // Defence in depth: the task contract should already have declared vision
    // when it carries images. If it did not, refuse rather than route an image
    // to whichever provider happens to be first.
    if (hasImages && !capabilities.includes(CAPABILITIES.VISION)) {
        throw new AiError('invalid_request', 'Task supplied images without declaring the vision capability.');
    }
    if (hasImages && task.images.length > 1 && !capabilities.includes(CAPABILITIES.MULTI_IMAGE)) {
        throw new AiError('invalid_request', 'Task supplied multiple images without declaring multi-image.');
    }
    if (hasImages) assertImagesAreWellFormed(task.images);

    const imageCount = hasImages ? task.images.length : 0;
    const totalDeadlineMs = Number.isInteger(task.totalDeadlineMs)
        ? task.totalDeadlineMs
        : DEFAULT_TOTAL_DEADLINE_MS;
    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(() => deadlineController.abort(), totalDeadlineMs);

    const providers = await resolveProviderOrder(deps);
    const configs = await resolveConfigs();
    const now = typeof deps.now === 'number' ? deps.now : Date.now();
    // `null` means config could not be read and this instance has no cached
    // copy, so it cannot tell which providers an operator disabled. See
    // `resolveConfigs`: refusing is the safe direction, and it is reported as a
    // categorised failure with telemetry rather than as an uncaught throw.
    const configUnavailable = configs === null;

    const attempted = [];
    const skipped = [];
    // Per-provider outcome, so a total failure can name each cause rather than
    // only the last one. Categories only — never bodies, prompts or credentials.
    const failures = [];
    let lastError = null;

    /**
     * The transaction record being assembled as the walk proceeds.
     *
     * One id per request, so the several provider attempts below can be read
     * back as one timeline. Returned to the caller as well, so a callable's own
     * log line can name the transaction an operator is looking at.
     */
    const transactionId = randomUUID();
    const attemptRecords = [];

    /** Appends one provider's turn. Metadata only — see ../telemetry/record.js. */
    function noteAttempt(record) {
        if (attemptRecords.length >= MAX_RECORDED_ATTEMPTS) return;
        attemptRecords.push(record);
    }

    /**
     * Names, on each entry, the provider the router moved on to.
     *
     * Redundant with the array order, and worth the duplication: it makes a
     * single attempt legible on its own, so a log line or a filtered view
     * showing one row still answers "and then what?".
     */
    function linkedAttempts() {
        return attemptRecords.map((entry, index) => ({
            ...entry,
            // The next provider actually *asked*, not merely the next row.
            // Naming a skipped provider here would read as "fell back to
            // Mistral" when Mistral was never contacted.
            nextProviderId: attemptRecords
                .slice(index + 1)
                .find((candidate) => candidate.status === 'attempted')?.providerId || null,
        }));
    }

    function noteSkip(provider, reason) {
        skipped.push({ providerId: provider.id, reason });
        noteAttempt({
            providerId: provider.id,
            attemptNumber: attemptRecords.length + 1,
            status: 'skipped',
            skipReason: reason,
            success: false,
        });
    }

    const transactionBase = {
        transactionId,
        taskType: task.taskType,
        capability: primaryCapability,
        requiredCapabilities: capabilities,
        inputSummary: describeTaskInput(task),
    };

    try {
        for (const provider of providers) {
            if (deadlineController.signal.aborted) {
                lastError = new AiError('deadline_exceeded', 'Total AI deadline reached.');
                break;
            }

            const evaluation = configUnavailable
                ? { eligible: false, reason: SKIP_REASONS.CONFIG_UNAVAILABLE }
                : await safeEvaluateProvider(provider, {
                    capabilities, primaryCapability, configs, now, deps, imageCount,
                });

            if (!evaluation.eligible) {
                noteSkip(provider, evaluation.reason);
                continue;
            }

            attempted.push(provider.id);
            const adapter = getAdapter(provider);
            const providerAttemptBudget = Math.max(1, provider.retryPolicy?.attempts || 1);

            let providerError = null;
            // A vendor that tells us when to come back earns one attempt beyond
            // the registry's policy, once. Groq refuses a request exceeding its
            // per-minute token budget and states the reset in about seven seconds;
            // against a two-minute task deadline, abandoning a working provider
            // over that is a waste. Bounded three ways: `MAX_RETRY_AFTER_MS` in
            // http.js caps the wait, `usedStatedWait` caps it to one occurrence,
            // and the deadline signal ends it regardless.
            let usedStatedWait = false;
            let maxAttempts = providerAttemptBudget;

            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                const attemptStartedAt = Date.now();
                if (attempt > 0) {
                    const stated = providerError?.retryAfterMs && !usedStatedWait
                        ? providerError.retryAfterMs
                        : 0;
                    if (stated) usedStatedWait = true;
                    const backoff = stated || provider.retryPolicy?.backoffMs || 0;
                    if (backoff > 0) await sleep(backoff, deadlineController.signal);
                    if (deadlineController.signal.aborted) break;
                }
                try {
                    const raw = await adapter.execute({
                        provider,
                        capability: primaryCapability,
                        model: evaluation.model,
                        systemInstructions: task.systemInstructions,
                        inputText: task.inputText,
                        images: task.images,
                        schema: task.outputSchema,
                        schemaName: task.schemaName || 'safehaul_task_output',
                        temperature: typeof task.temperature === 'number' ? task.temperature : 0,
                        maxOutputTokens: task.maxOutputTokens || 2048,
                        timeoutMs: Math.min(provider.timeoutMs, totalDeadlineMs),
                        parentSignal: deadlineController.signal,
                        credentials: evaluation.credentials.values,
                        config: evaluation.config,
                        fetchImpl: deps.fetchImpl,
                    });

                    const { output } = normalizeOutput({
                        text: raw.text,
                        schema: task.outputSchema,
                        providerId: provider.id,
                    });

                    await store.recordProviderOutcome(provider.id, {
                        success: true,
                        // Per lane: a working article generator says nothing about
                        // whether this provider can read a licence photograph, and
                        // recording it as though it did is what let a provider show
                        // as healthy while every CDL request to it was rejected.
                        lane: laneForCapability(primaryCapability),
                    });
                    const latencyMs = Date.now() - startedAt;
                    noteAttempt({
                        providerId: provider.id,
                        model: raw.model || evaluation.model,
                        attemptNumber: attemptRecords.length + 1,
                        status: 'attempted',
                        success: true,
                        latencyMs: Date.now() - attemptStartedAt,
                        // The output reached here, so it parsed *and* validated.
                        schemaValid: Boolean(task.outputSchema),
                        inputTokens: raw.usage?.inputTokens ?? null,
                        outputTokens: raw.usage?.outputTokens ?? null,
                    });
                    await recordAiTelemetry({
                        ...transactionBase,
                        providerId: provider.id,
                        model: raw.model || evaluation.model,
                        outcome: 'success',
                        latencyMs,
                        fallbackCount: attempted.length - 1,
                        attemptedProviders: attempted,
                        providersInvolved: attemptRecords.map((entry) => entry.providerId),
                        cooldownSkipped: skipped.filter((s) => s.reason === SKIP_REASONS.COOLDOWN).length,
                        credentialSource: evaluation.credentials.source,
                        // What the answer actually *said*, where the task can
                        // reduce it to a word. A successful transaction is not the
                        // same fact as a useful answer — a fact-check returning
                        // `supported: false` is a valid response that correctly
                        // refuses an article, and without this the Logs tab shows
                        // it as an unqualified success.
                        verdict: safeVerdict(task, output),
                        attempts: linkedAttempts(),
                    });

                    return {
                        output,
                        transactionId,
                        providerId: provider.id,
                        model: raw.model || evaluation.model,
                        latencyMs,
                        fallbackCount: attempted.length - 1,
                        credentialSource: evaluation.credentials.source,
                    };
                } catch (error) {
                    providerError = error instanceof AiError
                        ? error
                        : new AiError('internal', error?.message || 'Adapter failed.', { providerId: provider.id });

                    noteAttempt({
                        providerId: provider.id,
                        model: evaluation.model,
                        attemptNumber: attemptRecords.length + 1,
                        status: 'attempted',
                        success: false,
                        category: providerError.category,
                        // Both are already safe by construction: a status is a
                        // number, and the code was pattern-checked in http.js.
                        httpStatus: providerError.status,
                        vendorCode: providerError.vendorCode,
                        retryAfterMs: providerError.retryAfterMs,
                        latencyMs: Date.now() - attemptStartedAt,
                        // Records *why* fallback happened for a structured task:
                        // the vendor answered, but not in a shape SafeHaul could
                        // use. That reads very differently from an outage.
                        schemaValid: providerError.category === 'schema_validation_failed'
                            ? false
                            : undefined,
                    });

                    // Only a *task-fatal* category abandons the whole chain: a
                    // malformed SafeHaul request, no capable provider, or the
                    // deadline. Every vendor would answer those the same way.
                    if (isTaskFatal(providerError.category)) {
                        await finishFailure(task, providerError, {
                            attempted, skipped, startedAt, primaryCapability,
                            transactionBase, attempts: linkedAttempts(),
                        });
                        throw providerError;
                    }

                    // Grant one extra attempt when the vendor stated a short
                    // wait. The loop above performs the wait and re-executes, so
                    // there is exactly one code path that calls the adapter.
                    if (providerError.retryAfterMs && !usedStatedWait
                        && attempt === maxAttempts - 1
                        && !deadlineController.signal.aborted) {
                        maxAttempts += 1;
                        continue;
                    }

                    // Anything else ends this provider's turn, not the task.
                    // `unauthorized` is one vendor's key; `internal` is one
                    // adapter misbehaving. Throwing here let a single bad key or
                    // a single adapter bug disable all nine providers, which is
                    // exactly what the fallback order exists to prevent.
                    if (!providerError.retryable) break;
                }
            }

            if (providerError) {
                lastError = providerError;
                failures.push({ providerId: provider.id, category: providerError.category });
                await store.recordProviderOutcome(provider.id, {
                    success: false,
                    category: providerError.category,
                    // Which lane failed. A rejected CDL photograph must not count
                    // against the provider's article writing, and must not cool
                    // it out of that lane.
                    lane: laneForCapability(primaryCapability),
                    // The vendor's own statement of how long it is unavailable
                    // for, so a per-minute cap costs a minute rather than the
                    // flat half hour a spent daily allowance deserves.
                    retryAfterHintMs: providerError.retryAfterHintMs,
                });
            }
        }
    } catch (error) {
        // A task-fatal category has already recorded its telemetry and is on
        // its way out; pass it through untouched.
        if (error instanceof AiError) throw error;

        // Anything else escaping the walk — an unknown adapter, a Firestore
        // write that threw where it promised not to — must still leave the
        // platform's contract intact: a categorised `AiError` and exactly one
        // telemetry row. An uncategorised exception reaching a callable is how
        // "AI is broken" becomes unanswerable.
        const wrapped = new AiError('internal', error?.message || 'AI routing failed unexpectedly.');
        await finishFailure(task, wrapped, {
            attempted, skipped, startedAt, primaryCapability,
            transactionBase, attempts: linkedAttempts(),
        });
        throw wrapped;
    } finally {
        clearTimeout(deadlineTimer);
    }

    // Nothing succeeded. Say so plainly rather than inventing an answer.
    const failure = buildTerminalFailure({ attempted, skipped, lastError, failures });
    await finishFailure(task, failure, {
        attempted, skipped, startedAt, primaryCapability,
        transactionBase, attempts: linkedAttempts(),
    });
    failure.transactionId = transactionId;
    throw failure;
}

/**
 * Which providers could serve a capability set right now, in the order they
 * would actually be tried, and why the others could not.
 *
 * This is what lets the Super Admin console answer the question a bare ranking
 * cannot: *"Cerebras is enabled and configured — why is it never used for CDL
 * photographs?"* The answer is `incapable`, and it comes from the same
 * `evaluateProvider` the router itself uses rather than a second copy of the
 * rules that could drift from it.
 *
 * @param {string[]} capabilities the task's capability set
 * @param {object} [deps] injection seam. `configs` lets a caller that has
 *   already read `ai_provider_config` pass the map in rather than re-reading
 *   the collection once per capability set; `providerOrder` mirrors
 *   `runAiTask`'s seam.
 */
async function describeRouting(capabilities, deps = {}) {
    const normalized = normalizeCapabilities(capabilities);
    const primaryCapability = pickPrimaryCapability(normalized);
    // `null` when config is unreadable with no cached copy; the console then
    // shows every provider as `config_unavailable` rather than failing to load.
    const configs = deps.configs || await resolveConfigs();
    const configUnavailable = configs === null;
    const now = typeof deps.now === 'number' ? deps.now : Date.now();
    const providers = await resolveProviderOrder(deps);
    const rows = [];

    for (const provider of providers) {
        // Same non-throwing evaluation the router uses. A provider whose secret
        // cannot be read shows as `credential_error` on the console instead of
        // failing the whole AI Integrations page load.
        const evaluation = configUnavailable
            ? { eligible: false, reason: SKIP_REASONS.CONFIG_UNAVAILABLE }
            : await safeEvaluateProvider(provider, {
                capabilities: normalized, primaryCapability, configs, now, deps,
            });
        rows.push({
            providerId: provider.id,
            eligible: evaluation.eligible,
            reason: evaluation.reason || null,
            model: evaluation.model || null,
        });
    }
    return rows;
}

module.exports = {
    runAiTask,
    describeRouting,
    SKIP_REASONS,
    DEFAULT_TOTAL_DEADLINE_MS,
    resolveProviderOrder,
    __test: {
        evaluateProvider,
        safeEvaluateProvider,
        pickPrimaryCapability,
        normalizeOutput,
        safeVerdict,
        buildTerminalFailure,
        assertImagesAreWellFormed,
    },
};
