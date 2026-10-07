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
 *  2. **Try each compatible provider in turn**, in the effective order, until
 *     one produces a response that passes schema validation — and within a
 *     provider, its spare model versions when a failure is about one version
 *     (./versionPolicy.js).
 *  3. **One provider's failure is not the task's failure.** A timeout, an
 *     outage, an exhausted quota, malformed JSON, a rejected credential or an
 *     unexpected adapter exception all move to the next provider. Only a
 *     genuinely task-fatal category stops the walk — a malformed SafeHaul
 *     request, no capable provider, or the deadline — because those would get
 *     the same answer from all nine. See `isTaskFatal` in ./errors.js.
 *  4. **Bounded everywhere.** Per-provider timeout, a total request deadline,
 *     one attempt per version unless the registry marks a retry safe, at most
 *     three versions per lane, and persisted cooldowns and version rests so an
 *     exhausted provider or a withdrawn version is skipped rather than
 *     rediscovered by every cold instance.
 *  5. **Never fabricate.** If every compatible provider fails, the caller gets
 *     a safe error. There is no synthesized answer.
 */

// The pieces this loop decides with live beside it, one module per concern.
// `runAiTask` keeps the walk across providers, the deadline that spans every
// fallback, and the transaction record. One provider's turn — its attempts,
// retry policy, stated wait and recorded outcome — is ./providerTurn.js, which
// reports what happened and leaves what it means for the task to this loop.

const { CAPABILITIES, normalizeCapabilities } = require('../registry/capabilities');
const { AiError } = require('./errors');
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
const { assertImagesAreWellFormed, normalizeOutput, safeVerdict } = require('./output');
const { buildTerminalFailure, finishFailure } = require('./failure');
const { runProviderTurn } = require('./providerTurn');
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
    // A per-attempt ceiling, distinct from the total, is what makes failover
    // possible: without it the first provider may take the entire budget, so a
    // stalled provider leaves nothing for the next one. Tasks that must fail over
    // set it below the total; the rest are unchanged (Infinity == the old cap).
    const perAttemptDeadlineMs = Number.isInteger(task.perAttemptDeadlineMs)
        ? task.perAttemptDeadlineMs
        : Infinity;
    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(() => deadlineController.abort(), totalDeadlineMs);
    const timing = {
        startedAt, totalDeadlineMs, perAttemptDeadlineMs, signal: deadlineController.signal,
    };

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

    /**
     * Appends one attempt, numbered in order. Metadata only — see
     * ../telemetry/record.js.
     */
    function noteAttempt(record) {
        if (attemptRecords.length >= MAX_RECORDED_ATTEMPTS) return;
        attemptRecords.push({ ...record, attemptNumber: attemptRecords.length + 1 });
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
            const turn = await runProviderTurn({
                task, provider, evaluation, primaryCapability, timing, noteAttempt, deps,
            });

            if (turn.ok) {
                const latencyMs = Date.now() - startedAt;
                await recordAiTelemetry({
                    ...transactionBase,
                    providerId: provider.id,
                    model: turn.model,
                    outcome: 'success',
                    latencyMs,
                    fallbackCount: attempted.length - 1,
                    attemptedProviders: attempted,
                    // Each provider once, though several of its versions may
                    // have been tried.
                    providersInvolved: [...new Set(attemptRecords.map((entry) => entry.providerId))],
                    cooldownSkipped: skipped.filter((s) => s.reason === SKIP_REASONS.COOLDOWN).length,
                    credentialSource: evaluation.credentials.source,
                    // What the answer actually *said*, where the task can
                    // reduce it to a word. A successful transaction is not the
                    // same fact as a useful answer — a fact-check returning
                    // `supported: false` is a valid response that correctly
                    // refuses an article, and without this the Logs tab shows
                    // it as an unqualified success.
                    verdict: safeVerdict(task, turn.output),
                    attempts: linkedAttempts(),
                });

                return {
                    output: turn.output,
                    transactionId,
                    providerId: provider.id,
                    model: turn.model,
                    latencyMs,
                    fallbackCount: attempted.length - 1,
                    credentialSource: evaluation.credentials.source,
                };
            }

            // Only a *task-fatal* category abandons the whole chain: a
            // malformed SafeHaul request, no capable provider, or the
            // deadline. Every vendor would answer those the same way.
            if (turn.fatal) {
                await finishFailure(task, turn.error, {
                    attempted, skipped, startedAt, primaryCapability,
                    transactionBase, attempts: linkedAttempts(),
                });
                throw turn.error;
            }

            if (turn.error) {
                lastError = turn.error;
                failures.push({ providerId: provider.id, category: turn.error.category });
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
