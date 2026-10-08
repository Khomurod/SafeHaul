/**
 * One provider's turn in the router's walk.
 *
 * `router.js` keeps the walk across providers, the deadline that spans it and
 * the transaction record. This module owns what happens between choosing a
 * provider and moving on from it: the model versions it tries, the attempts on
 * each, the registry's retry policy, the vendor's stated wait, and the outcome
 * recorded against the provider. It hands back what happened — an answer, a
 * failure, or a failure that ends the task — and the router decides what that
 * means for the task.
 *
 * A failure about one version moves to the next version of the same provider
 * before the provider's turn ends; ./versionPolicy.js decides which failures
 * those are and how long the failed version rests. The provider's outcome is
 * still recorded once per turn, so its lane cooldown and its quota cooldown
 * count only turns in which no version answered.
 *
 * Part of the shared AI router. `router.js` keeps the task loop and the
 * public surface; these modules are the pieces it decides with.
 */

const { laneForCapability } = require('../registry/capabilities');
const { getAdapter } = require('../providers');
const { AiError, isTaskFatal } = require('./errors');
const store = require('../credentials/store');
const { normalizeOutput, sleep } = require('./output');
const { versionVerdict, fitsAnotherAttempt, INTERACTIVE_MAX_WAIT_MS } = require('./versionPolicy');

/**
 * Runs one provider's turn.
 *
 * A failure to record the outcome is not caught here. The router's own catch
 * turns it into a categorised `internal` failure with one telemetry row, which
 * is the contract an unexpected exception anywhere in the walk must keep.
 *
 * @param {object} turn
 * @param {object} turn.task normalized task contract
 * @param {object} turn.provider registry row
 * @param {object} turn.evaluation an eligible evaluation: config, credentials, model
 * @param {string} turn.primaryCapability
 * @param {{ startedAt: number, totalDeadlineMs: number, perAttemptDeadlineMs: number,
 *   signal: AbortSignal }} turn.timing the task's budget, shared by every turn
 * @param {Function} turn.noteAttempt appends one attempt to the transaction record
 * @param {object} [turn.deps] the router's injection seam
 * @param {() => Promise<boolean>} [turn.hasLaterProvider] whether a provider after
 *   this one could still serve the request; without it, one is assumed
 * @returns {Promise<{ ok: true, raw: object, output: *, model: string }
 *   | { ok: false, fatal: boolean, error: AiError }>}
 */
async function runProviderTurn({
    task, provider, evaluation, primaryCapability, timing, noteAttempt, deps = {}, hasLaterProvider,
}) {
    const { startedAt, totalDeadlineMs, perAttemptDeadlineMs, signal } = timing;
    const adapter = getAdapter(provider);
    const lane = laneForCapability(primaryCapability);
    const providerAttemptBudget = Math.max(1, provider.retryPolicy?.attempts || 1);
    const hasCeiling = perAttemptDeadlineMs !== Infinity;
    const models = Array.isArray(evaluation.models) && evaluation.models.length > 0
        ? evaluation.models
        : [evaluation.model];
    // Resting a version only means something when the lane has another one.
    const restsVersions = (evaluation.versionCount || models.length) > 1;
    const versionRests = new Map();
    const leftMs = () => totalDeadlineMs - (Date.now() - startedAt);
    // Under a ceiling, the time this provider may take is what it leaves the next
    // one: none to leave when no later provider can serve, so the last one asked
    // keeps a single slice back rather than two, and waits out a long stated
    // pause. Asked only when a decision turns on it.
    let lastResort = null;
    const isLastResort = async () => {
        if (lastResort === null) lastResort = hasLaterProvider ? !(await hasLaterProvider()) : false;
        return lastResort;
    };
    const slicesToKeep = async () => (hasCeiling && await isLastResort() ? 1 : 2);

    let providerError = null;
    // A vendor that tells us when to come back earns one attempt beyond
    // the registry's policy, once per turn. Groq refuses a request exceeding
    // its per-minute token budget and states the reset in about seven seconds;
    // against a two-minute task deadline, abandoning a working provider
    // over that is a waste. Bounded four ways: `MAX_RETRY_AFTER_MS` in
    // http.js caps the wait, `INTERACTIVE_MAX_WAIT_MS` caps it under a
    // per-attempt ceiling while a later provider can serve, `usedStatedWait`
    // caps it to one occurrence, and the deadline signal ends it regardless.
    let usedStatedWait = false;
    // The pause the next attempt here would wait: the vendor's, once a turn,
    // else the registry's backoff.
    const nextWaitMs = () => (providerError?.retryAfterMs && !usedStatedWait ? providerError.retryAfterMs : 0)
        || provider.retryPolicy?.backoffMs || 0;

    versions: for (let index = 0; index < models.length; index += 1) {
        const model = models[index];
        let maxAttempts = providerAttemptBudget;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const attemptStartedAt = Date.now();
            if (attempt > 0) {
                const backoff = nextWaitMs();
                if (providerError?.retryAfterMs) usedStatedWait = true;
                if (backoff > 0) await sleep(backoff, signal);
                if (signal.aborted) break versions;
            }
            // The smallest of: what the vendor is given, the task's
            // per-attempt ceiling, and the budget that is actually left. The
            // last term is what stops a late attempt being handed more time
            // than the deadline has remaining.
            const fullSliceMs = Math.min(provider.timeoutMs, perAttemptDeadlineMs);
            const timeoutMs = Math.min(fullSliceMs, Math.max(0, leftMs()));
            try {
                const raw = await adapter.execute({
                    provider,
                    capability: primaryCapability,
                    model,
                    systemInstructions: task.systemInstructions,
                    inputText: task.inputText,
                    images: task.images,
                    schema: task.outputSchema,
                    schemaName: task.schemaName || 'safehaul_task_output',
                    temperature: typeof task.temperature === 'number' ? task.temperature : 0,
                    maxOutputTokens: task.maxOutputTokens || 2048,
                    timeoutMs,
                    parentSignal: signal,
                    credentials: evaluation.credentials.values,
                    config: evaluation.config,
                    fetchImpl: deps.fetchImpl,
                });

                const { output } = normalizeOutput({
                    text: raw.text,
                    schema: task.outputSchema,
                    providerId: provider.id,
                });

                // It may have failed earlier in this turn and answered on a retry.
                versionRests.delete(model);
                await store.recordProviderOutcome(provider.id, {
                    success: true,
                    // Per lane: a working article generator says nothing about
                    // whether this provider can read a licence photograph, and
                    // recording it as though it did is what let a provider show
                    // as healthy while every CDL request to it was rejected.
                    lane,
                    ...restFields(versionRests),
                    // A version that rested earlier and answered now has proved itself.
                    ...(store.hasVersionRest(evaluation.config, lane, model) ? { clearRestFor: model } : {}),
                });
                noteAttempt({
                    providerId: provider.id,
                    model: raw.model || model,
                    status: 'attempted',
                    success: true,
                    latencyMs: Date.now() - attemptStartedAt,
                    // The output reached here, so it parsed *and* validated.
                    schemaValid: Boolean(task.outputSchema),
                    inputTokens: raw.usage?.inputTokens ?? null,
                    outputTokens: raw.usage?.outputTokens ?? null,
                });
                return { ok: true, raw, output, model: raw.model || model };
            } catch (error) {
                providerError = error instanceof AiError
                    ? error
                    : new AiError('internal', error?.message || 'Adapter failed.', { providerId: provider.id });

                noteAttempt({
                    providerId: provider.id,
                    model,
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
                    return { ok: false, fatal: true, error: providerError };
                }

                const verdict = versionVerdict(providerError, {
                    hasCeiling, fullSlice: timeoutMs >= fullSliceMs,
                });
                if (verdict.rest && restsVersions) {
                    versionRests.set(model, { model, until: Date.now() + verdict.rest.ms, reason: verdict.rest.reason });
                }

                // A failure about this version: try the next one now, without
                // waiting, if the budget still holds it and, while a later
                // provider can serve, a fallback after it.
                if (verdict.switchVersion && index < models.length - 1 && !signal.aborted
                    && fitsAnotherAttempt({ leftMs: leftMs(), perAttemptDeadlineMs, slicesAfter: await slicesToKeep() })) {
                    continue versions;
                }

                // A stated wait. Under a per-attempt ceiling a person is
                // waiting for this read, so a long wait is not served here
                // while a later provider can be asked at once. Otherwise grant
                // one extra attempt when the wait still leaves a full slice
                // after it; the loop above performs the wait and re-executes, so
                // there is exactly one code path that calls the adapter.
                if (providerError.retryAfterMs && !usedStatedWait) {
                    if (hasCeiling && providerError.retryAfterMs > INTERACTIVE_MAX_WAIT_MS
                        && !(await isLastResort())) break versions;
                    if (attempt === maxAttempts - 1 && !signal.aborted
                        && fitsAnotherAttempt({
                            leftMs: leftMs(), waitMs: providerError.retryAfterMs, perAttemptDeadlineMs, slicesAfter: 1,
                        })) {
                        maxAttempts += 1;
                        continue;
                    }
                }

                // Anything else ends this provider's turn, not the task.
                // `unauthorized` is one vendor's key; `internal` is one
                // adapter misbehaving. Throwing here let a single bad key or
                // a single adapter bug disable all nine providers, which is
                // exactly what the fallback order exists to prevent.
                if (!providerError.retryable) break versions;

                // A retry is still this provider's turn, so under a ceiling
                // it has to leave a full slice for the next provider as well,
                // when there is one. Otherwise a provider with a retry policy,
                // placed first, spends two ceilings on one stall and starves
                // the fallback. The wait counted is the one the retry will take.
                if (attempt < maxAttempts - 1 && !fitsAnotherAttempt({
                    leftMs: leftMs(), waitMs: nextWaitMs(), perAttemptDeadlineMs,
                    slicesAfter: await slicesToKeep(),
                })) break versions;
            }
        }
        // This version's attempts are spent and nothing allowed a switch.
        break;
    }

    if (providerError) {
        await store.recordProviderOutcome(provider.id, {
            success: false,
            category: providerError.category,
            // Which lane failed. A rejected CDL photograph must not count
            // against the provider's article writing, and must not cool
            // it out of that lane.
            lane,
            // The vendor's own statement of how long it is unavailable
            // for, so a per-minute cap costs a minute rather than the
            // flat half hour a spent daily allowance deserves.
            retryAfterHintMs: providerError.retryAfterHintMs,
            ...restFields(versionRests),
        });
    }
    return { ok: false, fatal: false, error: providerError };
}

/** The rests a turn found, as outcome fields; nothing at all when there are none. */
function restFields(versionRests) {
    return versionRests.size > 0 ? { versionRests: [...versionRests.values()] } : {};
}

module.exports = { runProviderTurn };
