/**
 * One provider's turn in the router's walk.
 *
 * `router.js` keeps the walk across providers, the deadline that spans it and
 * the transaction record. This module owns what happens between choosing a
 * provider and moving on from it: the attempts, the registry's retry policy,
 * the vendor's stated wait, and the outcome recorded against the provider. It
 * hands back what happened — an answer, a failure, or a failure that ends the
 * task — and the router decides what that means for the task.
 *
 * Part of the shared AI router. `router.js` keeps the task loop and the
 * public surface; these modules are the pieces it decides with.
 */

const { laneForCapability } = require('../registry/capabilities');
const { getAdapter } = require('../providers');
const { AiError, isTaskFatal } = require('./errors');
const store = require('../credentials/store');
const { normalizeOutput, sleep } = require('./output');

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
 * @returns {Promise<{ ok: true, raw: object, output: *, model: string }
 *   | { ok: false, fatal: boolean, error: AiError }>}
 */
async function runProviderTurn({
    task, provider, evaluation, primaryCapability, timing, noteAttempt, deps = {},
}) {
    const { startedAt, totalDeadlineMs, perAttemptDeadlineMs, signal } = timing;
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
            if (backoff > 0) await sleep(backoff, signal);
            if (signal.aborted) break;
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
                // The smallest of: what the vendor is given, the task's
                // per-attempt ceiling, and the budget that is actually
                // left. The last term is what stops a late attempt being
                // handed more time than the deadline has remaining.
                timeoutMs: Math.min(
                    provider.timeoutMs,
                    perAttemptDeadlineMs,
                    Math.max(0, totalDeadlineMs - (Date.now() - startedAt)),
                ),
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

            await store.recordProviderOutcome(provider.id, {
                success: true,
                // Per lane: a working article generator says nothing about
                // whether this provider can read a licence photograph, and
                // recording it as though it did is what let a provider show
                // as healthy while every CDL request to it was rejected.
                lane: laneForCapability(primaryCapability),
            });
            noteAttempt({
                providerId: provider.id,
                model: raw.model || evaluation.model,
                status: 'attempted',
                success: true,
                latencyMs: Date.now() - attemptStartedAt,
                // The output reached here, so it parsed *and* validated.
                schemaValid: Boolean(task.outputSchema),
                inputTokens: raw.usage?.inputTokens ?? null,
                outputTokens: raw.usage?.outputTokens ?? null,
            });
            return { ok: true, raw, output, model: raw.model || evaluation.model };
        } catch (error) {
            providerError = error instanceof AiError
                ? error
                : new AiError('internal', error?.message || 'Adapter failed.', { providerId: provider.id });

            noteAttempt({
                providerId: provider.id,
                model: evaluation.model,
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

            // Grant one extra attempt when the vendor stated a short
            // wait. The loop above performs the wait and re-executes, so
            // there is exactly one code path that calls the adapter.
            //
            // But a stated wait is still this provider's turn: honouring a
            // 30s wait (the `MAX_RETRY_AFTER_MS` cap) under a task with a
            // per-attempt ceiling would consume the budget reserved for
            // failing over to a healthy provider — the very thing the
            // ceiling exists to protect. So when a ceiling is set, only
            // wait if what remains after it still leaves a full slice for a
            // fallback; otherwise move on to the next provider now.
            const budgetLeftMs = totalDeadlineMs - (Date.now() - startedAt);
            const retryFitsReserve = perAttemptDeadlineMs === Infinity
                || budgetLeftMs - (providerError.retryAfterMs || 0) >= perAttemptDeadlineMs;
            if (providerError.retryAfterMs && !usedStatedWait
                && attempt === maxAttempts - 1
                && retryFitsReserve
                && !signal.aborted) {
                maxAttempts += 1;
                continue;
            }

            // Anything else ends this provider's turn, not the task.
            // `unauthorized` is one vendor's key; `internal` is one
            // adapter misbehaving. Throwing here let a single bad key or
            // a single adapter bug disable all nine providers, which is
            // exactly what the fallback order exists to prevent.
            if (!providerError.retryable) break;

            // A retry is still this provider's turn, so under a ceiling
            // it has to leave a full slice for the next provider as well.
            // Otherwise a provider with a retry policy, placed first,
            // spends two ceilings on one stall and starves the fallback.
            if (perAttemptDeadlineMs !== Infinity && attempt < maxAttempts - 1) {
                const leftMs = totalDeadlineMs - (Date.now() - startedAt);
                const backoffMs = provider.retryPolicy?.backoffMs || 0;
                if (leftMs - backoffMs - perAttemptDeadlineMs < perAttemptDeadlineMs) break;
            }
        }
    }

    if (providerError) {
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
    return { ok: false, fatal: false, error: providerError };
}

module.exports = { runProviderTurn };
