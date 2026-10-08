/**
 * When a failed model version should hand over to the next version of the same
 * provider, and how long it should rest.
 *
 * A vendor withdraws, overloads or re-tiers one version far more often than it
 * goes down whole, and on 2026-10-07 all three happened at once: Groq answered
 * 404 for its vision model, Mistral's free plan gave two versions a limit of
 * zero requests a minute, and Gemini's Flash versions were overloaded. With one
 * version per lane, each of those took the whole provider out of the lane.
 *
 * The rule follows whose problem the failure is:
 *
 *  - **About this version** — gone (404), not on this plan (a limit of zero, a
 *    tier refusal), its own rate limit spent (429), or a request it would not
 *    take (400/422). Another version of the same provider is the obvious next
 *    try, so the router switches without waiting.
 *  - **About the vendor** — overloaded (5xx) or too slow (timeout). Its other
 *    versions are struggling too: Gemini's Lite version took 13-16s to read a
 *    licence photo while the Flash versions answered 503, against 1-2s on Groq.
 *    So a document read, which has a per-attempt ceiling and a person waiting,
 *    goes to the next provider. Work without a ceiling (articles) has the time
 *    to try the other versions first.
 *  - **About the account or the answer** — a rejected key, a spent allowance,
 *    a network fault, an unusable answer. Another version would fare the same.
 *
 * A failed version rests, in the lane it failed in, so the next request starts
 * on one that works: a day when it is gone or not on the plan, the vendor's own
 * stated wait (one to ten minutes) when it is rate-limited, ten minutes when it
 * timed out with its full time. A rest is a preference, never a gate: when every
 * version of a lane rests, the router tries them all, soonest-recovering first,
 * and the provider is protected by its ordinary lane cooldown, as before.
 *
 * Part of the shared AI router. `router.js` keeps the task loop and the
 * public surface; these modules are the pieces it decides with.
 */

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** A version the vendor no longer offers, or offers to no one on this plan. */
const REMOVED_REST_MS = 24 * HOUR_MS;
/** A version that spent its whole slice without answering. */
const SLOW_REST_MS = 10 * MINUTE_MS;
/** A rate-limited version: the vendor's stated wait, within these bounds. */
const RATE_LIMIT_REST_MIN_MS = MINUTE_MS;
const RATE_LIMIT_REST_MAX_MS = 10 * MINUTE_MS;

/**
 * The longest vendor-stated wait a document read holds a person for.
 *
 * Groq answers a spent per-minute token budget with a wait of seven to
 * twenty-five seconds, and the router used to sit through it while Mistral
 * could have read the document in three. Anything longer, under a per-attempt
 * ceiling, moves on to the next provider at once, while one after it can serve;
 * the last one able to waits, when a full attempt still fits after the wait.
 * Work without a ceiling still waits, up to `MAX_RETRY_AFTER_MS` in
 * ../providers/http.js.
 */
const INTERACTIVE_MAX_WAIT_MS = 5000;

const REST_REASONS = Object.freeze({
    REMOVED: 'removed',
    RATE_LIMITED: 'rate_limited',
    SLOW: 'slow',
});

/**
 * What one failed version means for the rest of this provider's turn.
 *
 * @param {object} error an `AiError`
 * @param {object} context
 * @param {boolean} context.hasCeiling the task set a per-attempt deadline
 * @param {boolean} [context.fullSlice] the attempt was given its whole slice,
 *   not a remainder cut short by the task's total deadline
 * @returns {{ switchVersion: boolean, rest: ({ reason: string, ms: number }|null) }}
 */
function versionVerdict(error, { hasCeiling, fullSlice = false }) {
    switch (error?.category) {
        case 'model_unavailable':
            return { switchVersion: true, rest: { reason: REST_REASONS.REMOVED, ms: REMOVED_REST_MS } };
        case 'rate_limited': {
            const stated = Number.isFinite(error.retryAfterHintMs) ? error.retryAfterHintMs : 0;
            const ms = Math.min(RATE_LIMIT_REST_MAX_MS, Math.max(RATE_LIMIT_REST_MIN_MS, stated));
            return { switchVersion: true, rest: { reason: REST_REASONS.RATE_LIMITED, ms } };
        }
        case 'provider_request_rejected':
            // Switch, but no rest: the request may be at fault (an image this
            // model will not take), and that says nothing about the next one.
            return { switchVersion: true, rest: null };
        case 'provider_unavailable':
            return { switchVersion: !hasCeiling, rest: null };
        case 'timeout':
            // Only a full slice is evidence the version is slow. A late attempt
            // cut short by the total deadline proves nothing about it.
            return { switchVersion: false, rest: fullSlice ? { reason: REST_REASONS.SLOW, ms: SLOW_REST_MS } : null };
        default:
            return { switchVersion: false, rest: null };
    }
}

/**
 * Whether the task's budget still holds another attempt on this provider.
 *
 * One rule for every "try again here" decision, so they cannot drift apart:
 * after `waitMs`, at least `slicesAfter` per-attempt slices must remain. A retry
 * or a switch to another version needs two (its own, and one for the next
 * provider), or one when no later provider can serve; waiting on a vendor's
 * stated pause needs one. A task without a per-attempt ceiling is bounded only
 * by its total deadline, as before.
 */
function fitsAnotherAttempt({ leftMs, waitMs = 0, perAttemptDeadlineMs, slicesAfter }) {
    if (perAttemptDeadlineMs === Infinity) return true;
    return leftMs - waitMs >= slicesAfter * perAttemptDeadlineMs;
}

/**
 * The order to walk a lane's versions in, given which ones are resting.
 *
 * Resting versions are left out while any other remains. When all rest, all are
 * tried, soonest-recovering first, so a version gone for a day comes last and a
 * provider is never shut out by its rests alone.
 *
 * @param {string[]} models the lane's versions, in preference order
 * @param {Map<string, number>} resting model -> rest end, for this lane
 * @returns {string[]}
 */
function orderForWalk(models, resting) {
    const available = models.filter((model) => !resting.has(model));
    if (available.length > 0) return available;
    return [...models].sort((a, b) => resting.get(a) - resting.get(b));
}

module.exports = {
    REMOVED_REST_MS,
    SLOW_REST_MS,
    RATE_LIMIT_REST_MIN_MS,
    RATE_LIMIT_REST_MAX_MS,
    INTERACTIVE_MAX_WAIT_MS,
    REST_REASONS,
    versionVerdict,
    fitsAnotherAttempt,
    orderForWalk,
};
