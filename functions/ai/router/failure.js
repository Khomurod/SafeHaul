/**
 * The terminal failure a task gets when no provider could serve it.
 *
 * It carries what was attempted and what was skipped, because "no provider
 * available" on its own is the message that sent operators looking in the wrong
 * place.
 *
 * Part of the shared AI router. `router.js` keeps the task loop and the
 * public surface; these modules are the pieces it decides with.
 */

const { AiError } = require('./errors');
const { recordAiTelemetry } = require('../telemetry/record');
const { SKIP_REASONS } = require('./eligibility');
/**
 * Distinguishes "every provider tried and failed" from "nothing was even
 * eligible", because those need different operator action: the first is an
 * outage, the second is a configuration gap.
 */
function buildTerminalFailure({ attempted, skipped, lastError, failures = [] }) {
    // The deadline outranks everything below it. It used to be overwritten with
    // `all_providers_failed`, or — when it fired before anything was tried —
    // with `not_configured`, which tells an operator to go and check
    // credentials that were never the problem. "We ran out of time" is a
    // different fault from "nothing is configured" and needs a different fix.
    if (lastError?.category === 'deadline_exceeded') return lastError;

    if (attempted.length > 0) {
        // Name every provider and the category it failed with, in order.
        //
        // `all_providers_failed` on its own is unactionable: a production run
        // reported it for four hours and the only way to learn *why* each
        // provider failed was to reconstruct the pipeline locally. Categories are
        // safe to log — they carry no credential, no provider response body and
        // no prompt, which is the whole reason the taxonomy exists.
        const trail = failures.length
            ? failures.map((entry) => `${entry.providerId}=${entry.category}`).join(', ')
            : attempted.join(', ');
        return new AiError('all_providers_failed',
            `${attempted.length} provider(s) attempted [${trail}];`
            + ` last failure ${lastError?.category || 'unknown'}.`);
    }
    // Distinct from "nothing is configured": the configuration exists and could
    // not be read, so pointing an operator at credentials would waste their time.
    if (skipped.length > 0 && skipped.every((entry) => entry.reason === SKIP_REASONS.CONFIG_UNAVAILABLE)) {
        return new AiError('not_configured', 'Provider configuration could not be read.');
    }

    // A credential SafeHaul could not read outranks every other skip reason,
    // because it is the only one an operator can fix and the only one that is
    // *our* fault. Before this branch existed the walk fell through to
    // `not_configured`, which `cdlParser.js` renders as "AI auto-fill is not
    // configured on the server." — shown verbatim to a driver mid-application,
    // while the credentials sat correctly in Secret Manager and the runtime
    // simply lacked `secretAccessor`. That one line is the reported symptom this
    // whole stage exists to remove.
    //
    // `some`, not `every`: a vision task legitimately skips the text-only
    // providers as `incapable`, so requiring every skip to be a credential error
    // would never fire on the exact path that reported it.
    if (skipped.some((entry) => entry.reason === SKIP_REASONS.CREDENTIAL_ERROR)) {
        const affected = skipped
            .filter((entry) => entry.reason === SKIP_REASONS.CREDENTIAL_ERROR)
            .map((entry) => entry.providerId)
            .join(', ');
        return new AiError('credential_error',
            `Credentials unreadable for ${affected || 'every eligible provider'};`
            + ' check Secret Manager access for the Functions runtime.');
    }

    const onlyIncapable = skipped.length > 0
        && skipped.every((entry) => entry.reason === SKIP_REASONS.INCAPABLE || entry.reason === SKIP_REASONS.RETIRED);
    if (onlyIncapable) {
        return new AiError('capability_unavailable', 'No provider supports the required capabilities.');
    }
    return new AiError('not_configured', 'No configured, enabled provider can serve this task.');
}

async function finishFailure(task, error, {
    attempted, skipped, startedAt, primaryCapability, transactionBase = {}, attempts = [],
}) {
    await recordAiTelemetry({
        taskType: task.taskType,
        capability: primaryCapability,
        ...transactionBase,
        providerId: error.providerId || null,
        outcome: 'failure',
        category: error.category,
        latencyMs: Date.now() - startedAt,
        fallbackCount: Math.max(0, attempted.length - 1),
        attemptedProviders: attempted,
        providersInvolved: attempts.map((entry) => entry.providerId),
        cooldownSkipped: skipped.filter((entry) => entry.reason === SKIP_REASONS.COOLDOWN).length,
        attempts,
    });
}

module.exports = { buildTerminalFailure, finishFailure };
