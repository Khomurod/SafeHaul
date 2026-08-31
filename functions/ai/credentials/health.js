// functions/ai/credentials/health.js
//
// Provider health: the cooldown windows and their sizing, per-lane failure
// accounting, the recorded outcome of every routed call, the stored
// health-check results, and the operator's cooldown clear. Extracted
// verbatim from `store.js`.

const { admin } = require('../../firebaseAdmin');
const { LANES, ALL_LANES, isLane } = require('../registry/capabilities');
const { configRef, readConfig } = require('./configDoc');

/** Cooldown windows. Quota exhaustion earns a longer rest than a blip. */
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 30 * 60 * 1000;
const FAILURES_BEFORE_COOLDOWN = 3;

// ---------------------------------------------------------------------------
// Health, cooldown and quota state
// ---------------------------------------------------------------------------

/**
 * Records the outcome of a provider attempt and applies cooldown.
 *
 * Cooldown is stored rather than held in memory because Cloud Functions
 * instances are ephemeral and independent — an in-memory counter would let a
 * dozen cold instances each rediscover the same exhausted quota.
 */
/**
 * How long to rest a provider that reported a quota or rate-limit failure.
 *
 * Derived from the vendor's own statement when it made one, because a flat
 * 30 minutes is the right answer for a spent daily allowance and badly the
 * wrong one for a per-minute cap. Gemini's free tier allows 20 requests per
 * minute and its error says "Please retry in 44.26781542s"; resting it for
 * 30 minutes removed the highest-priority provider from every lane for forty
 * times longer than the vendor asked for.
 *
 * A small buffer is added so the retry lands *after* the window rather than on
 * its edge, and the flat 30 minutes remains both the ceiling and the answer
 * when the vendor said nothing.
 */
const QUOTA_COOLDOWN_FLOOR_MS = 5 * 1000;
const QUOTA_COOLDOWN_BUFFER_MS = 2 * 1000;

function quotaCooldownMs(retryAfterHintMs) {
    if (!Number.isFinite(retryAfterHintMs) || retryAfterHintMs <= 0) return QUOTA_COOLDOWN_MS;
    const withBuffer = retryAfterHintMs + QUOTA_COOLDOWN_BUFFER_MS;
    return Math.min(QUOTA_COOLDOWN_MS, Math.max(QUOTA_COOLDOWN_FLOOR_MS, withBuffer));
}

/**
 * Records the outcome of a provider attempt, per lane, and applies cooldown.
 *
 * ## Why the lane matters
 *
 * This used to keep one `health` scalar and one `consecutiveFailures` counter for
 * the whole provider, and both were wrong in the same way: a provider's text lane
 * and its image lane reach different models, in different request shapes, on
 * different vendor entitlements, and they fail independently.
 *
 * Two concrete consequences, both reported from production:
 *
 *  - **A provider looked healthy while a capability was completely broken.** Any
 *    success set `health: 'healthy'`, so blog articles generating normally kept
 *    resetting the badge while every CDL photograph handed to the same provider
 *    was being rejected.
 *  - **A broken image lane disabled a working text one.** Three rejected images
 *    reached `FAILURES_BEFORE_COOLDOWN` and the resulting cooldown removed the
 *    provider from *every* lane, including the one that was working.
 *
 * So failure counting and failure cooldowns are per lane. Quota and rate-limit
 * cooldowns stay provider-wide, deliberately: a vendor allowance is an account
 * fact, not a capability fact, and pretending otherwise would keep hammering a
 * spent quota through the other lane.
 *
 * `health` is still written as a single scalar for the console's summary, derived
 * as the worst of the lanes that have a recorded state, so nothing that reads it
 * breaks — it is simply no longer the only thing recorded.
 */
async function recordProviderOutcome(providerId, outcome) {
    const { success, category } = outcome;
    const lane = isLane(outcome.lane) ? outcome.lane : LANES.TEXT;
    const now = Date.now();
    const current = await readConfig(providerId).catch(() => ({}));
    const laneHealth = { ...(current.laneHealth || {}) };
    const laneFailures = { ...(current.laneFailures || {}) };

    const update = {
        lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (success) {
        laneHealth[lane] = 'healthy';
        laneFailures[lane] = 0;
        update.lastSuccessAt = admin.firestore.FieldValue.serverTimestamp();
        // A success in this lane clears this lane's failure cooldown. A quota
        // cooldown is provider-wide, and a success proves the allowance is back,
        // so that clears too.
        update[`laneCooldownUntil_${lane}`] = admin.firestore.FieldValue.delete();
        update.cooldownUntil = admin.firestore.FieldValue.delete();
        update.cooldownReason = admin.firestore.FieldValue.delete();
        // Kept in step for anything still reading the flat counter.
        update.consecutiveFailures = 0;
    } else {
        const failures = Number(laneFailures[lane] || 0) + 1;
        laneFailures[lane] = failures;
        update.lastFailureCategory = typeof category === 'string' ? category.slice(0, 40) : 'internal';
        update.lastFailureLane = lane;
        laneHealth[lane] = 'degraded';
        update.consecutiveFailures = failures;

        const quotaFailure = category === 'quota_exceeded' || category === 'rate_limited';
        if (quotaFailure) {
            // Provider-wide: an exhausted allowance is not a property of one lane.
            update.cooldownUntil = now + quotaCooldownMs(outcome.retryAfterHintMs);
            update.cooldownReason = 'quota';
            laneHealth[lane] = 'quota';
        } else if (failures >= FAILURES_BEFORE_COOLDOWN) {
            // Lane-scoped: a rejected image says nothing about an article.
            update[`laneCooldownUntil_${lane}`] = now + FAILURE_COOLDOWN_MS;
        }
    }

    update.laneHealth = laneHealth;
    update.laneFailures = laneFailures;
    update.health = worstLaneHealth(laneHealth);

    try {
        await configRef(providerId).set(update, { merge: true });
    } catch (error) {
        // Health bookkeeping must never turn a successful AI call into a
        // failure, nor mask a real one.
        console.error(`[ai/credentials] Could not record outcome for ${providerId}: ${error?.message}`);
    }
}

/** Worst first: one broken lane must not be hidden by another working one. */
const HEALTH_SEVERITY = ['quota', 'degraded', 'healthy'];

function worstLaneHealth(laneHealth) {
    const states = Object.values(laneHealth || {}).filter(Boolean);
    if (states.length === 0) return 'unknown';
    return HEALTH_SEVERITY.find((state) => states.includes(state)) || 'unknown';
}

/**
 * Whether a provider is resting, optionally for one lane.
 *
 * With no lane, reports whether *any* cooldown is active — the provider-wide view
 * the console shows. With a lane, reports the cooldowns that actually apply to it:
 * the provider-wide quota rest, plus that lane's own failure rest. A failure
 * cooldown earned by rejected images must not remove the provider from the text
 * lane, which is what a single shared window did.
 */
function cooldownState(config, now = Date.now(), lane = null) {
    const quotaUntil = Number(config?.cooldownUntil || 0);
    if (quotaUntil > now) {
        return { active: true, until: quotaUntil, reason: config.cooldownReason || 'failures' };
    }

    const lanes = isLane(lane) ? [lane] : ALL_LANES;
    for (const candidate of lanes) {
        const until = Number(config?.[`laneCooldownUntil_${candidate}`] || 0);
        if (until > now) {
            return { active: true, until, reason: 'failures', lane: candidate };
        }
    }
    return { active: false, until: null, reason: null };
}

async function clearCooldown(providerId) {
    const update = {
        cooldownUntil: admin.firestore.FieldValue.delete(),
        cooldownReason: admin.firestore.FieldValue.delete(),
        consecutiveFailures: 0,
        laneFailures: {},
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Every lane, not only the provider-wide window: an operator clearing a
    // cooldown means "try this provider again", and leaving one lane resting
    // would make that only half true.
    for (const lane of ALL_LANES) {
        update[`laneCooldownUntil_${lane}`] = admin.firestore.FieldValue.delete();
    }
    await configRef(providerId).set(update, { merge: true });
}

/**
 * The per-capability breakdown, as it is stored.
 *
 * Only these fields, bounded and truncated — the same allowlist discipline the
 * telemetry module applies, and for the same reason: a probe result is the place
 * a vendor's own words could most easily arrive. `message` is SafeHaul's own
 * safe category text, never a vendor body, and is kept because it is what makes
 * a stored result readable a day later.
 */
const MAX_STORED_CAPABILITIES = 12;

function summarizeCapabilities(capabilities) {
    if (!Array.isArray(capabilities)) return [];
    return capabilities.slice(0, MAX_STORED_CAPABILITIES).map((probe) => ({
        id: String(probe?.id || '').slice(0, 40),
        label: String(probe?.label || '').slice(0, 60),
        status: String(probe?.status || 'failed').slice(0, 20),
        category: probe?.category ? String(probe.category).slice(0, 40) : null,
        // The two most diagnostic facts about a vendor failure, and both are safe
        // by construction: a status is a number and the code was pattern-checked
        // in providers/http.js before it ever became an AiError field.
        httpStatus: Number.isInteger(probe?.httpStatus) ? probe.httpStatus : null,
        vendorCode: typeof probe?.vendorCode === 'string' ? probe.vendorCode.slice(0, 64) : null,
        model: probe?.model ? String(probe.model).slice(0, 120) : null,
        latencyMs: Number.isFinite(probe?.latencyMs) ? Math.round(probe.latencyMs) : null,
        message: String(probe?.message || '').slice(0, 200),
    }));
}

/**
 * Records a connection test, including the per-capability breakdown.
 *
 * The breakdown was previously computed, returned once, and thrown away. So the
 * row said "text ✓, single-image ✗" for as long as the operator stayed on the
 * page and a bare **Failed** after any reload — which is when they come back to
 * look. Storing it is what makes "this provider's vision lane is broken and its
 * text lane is fine" a fact about the deployment rather than a fact about one
 * browser tab.
 */
async function recordTestResult(providerId, result) {
    await configRef(providerId).set({
        lastTestAt: admin.firestore.FieldValue.serverTimestamp(),
        lastTestSuccess: Boolean(result?.success),
        lastTestCategory: result?.success ? null : (result?.category || 'internal'),
        lastTestCapabilities: summarizeCapabilities(result?.capabilities),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

module.exports = {
    FAILURE_COOLDOWN_MS,
    QUOTA_COOLDOWN_MS,
    FAILURES_BEFORE_COOLDOWN,
    QUOTA_COOLDOWN_FLOOR_MS,
    QUOTA_COOLDOWN_BUFFER_MS,
    quotaCooldownMs,
    recordProviderOutcome,
    worstLaneHealth,
    cooldownState,
    clearCooldown,
    MAX_STORED_CAPABILITIES,
    summarizeCapabilities,
    recordTestResult,
};
