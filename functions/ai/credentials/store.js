/**
 * Provider credential and configuration store.
 *
 * Splits cleanly in two:
 *  - **Secrets** live in Google Secret Manager (`./secretManager`). No
 *    plaintext token is ever written to Firestore.
 *  - **Non-secret settings** — enabled/disabled, account ids, model overrides,
 *    last-test results, cooldown state — live in a single server-only
 *    Firestore document, `ai_provider_config/{providerId}`. That collection is
 *    denied to all clients in `firestore.rules`; the console reads it through
 *    an audited Super Admin callable.
 *
 * The legacy `GROQ_API_KEY` binding is honoured as a read-only fallback so
 * production CDL and E-Doc parsing keeps working from the moment this deploys,
 * before anyone has migrated anything. See `resolveCredentials`.
 */

const { admin, db } = require('../../firebaseAdmin');
const { requireProvider, isRetired } = require('../registry/providers');
const { LANES, ALL_LANES, isLane } = require('../registry/capabilities');
const { readSecret, writeSecret, destroySecretVersions } = require('./secretManager');

const COLLECTION = 'ai_provider_config';

/** Cooldown windows. Quota exhaustion earns a longer rest than a blip. */
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 30 * 60 * 1000;
const FAILURES_BEFORE_COOLDOWN = 3;

function configRef(providerId) {
    // Registry-resolved, so the document id can never come from a request.
    return db.collection(COLLECTION).doc(requireProvider(providerId).id);
}

/**
 * Reads stored non-secret settings.
 *
 * @returns {Promise<object>} always an object; absent documents read as
 *   `{ enabled: true }` so a freshly-configured provider works without an
 *   explicit enable step.
 */
async function readConfig(providerId) {
    const snapshot = await configRef(providerId).get();
    if (!snapshot.exists) return { enabled: true };
    const data = snapshot.data() || {};
    return { enabled: data.enabled !== false, ...data };
}

async function readAllConfigs() {
    const snapshot = await db.collection(COLLECTION).get();
    const byId = new Map();
    snapshot.forEach((doc) => byId.set(doc.id, { enabled: true, ...(doc.data() || {}) }));
    return byId;
}

/**
 * Merges non-secret settings. Only fields declared on the registry row are
 * accepted, so an operator cannot write arbitrary keys into the document.
 */
async function writeConfig(providerId, patch) {
    const provider = requireProvider(providerId);
    const allowed = new Set(provider.configFields.map((field) => field.name));
    const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

    for (const [key, value] of Object.entries(patch || {})) {
        if (key === 'enabled') {
            update.enabled = value !== false;
            continue;
        }
        if (!allowed.has(key)) {
            throw new Error(`"${key}" is not a configurable setting for ${provider.displayName}.`);
        }
        const field = provider.configFields.find((candidate) => candidate.name === key);
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (!trimmed) {
            update[key] = admin.firestore.FieldValue.delete();
            continue;
        }
        if (field.pattern && !new RegExp(field.pattern).test(trimmed)) {
            throw new Error(`${field.label} is not in the expected format.`);
        }
        if (trimmed.length > 200) {
            throw new Error(`${field.label} is too long.`);
        }
        update[key] = trimmed;
    }

    await configRef(providerId).set(update, { merge: true });
    return readConfig(providerId);
}

/**
 * Resolves every credential a provider needs.
 *
 * **Absent and unreadable are different facts, and this is where they separate.**
 * `readSecret` returns null for a secret that does not exist and re-throws
 * anything else — `PERMISSION_DENIED` when the runtime service account is
 * missing `roles/secretmanager.secretAccessor`, `UNAVAILABLE`, a project quota
 * error. Both used to arrive at callers as "not configured", and that single
 * conflation produced the whole family of "AI is not configured even though the
 * credentials exist" reports: the console told an operator to add a key that
 * was already there, and the router reported a configuration gap for an IAM
 * fault.
 *
 * So a failing read is recorded against its field in `unreadable` and the
 * remaining fields are still attempted. Nothing throws, because every caller
 * needs to keep going: the router must try the next provider, the console must
 * still render a row, and the connection test must still say something useful.
 *
 * @returns {Promise<{ complete: boolean, values: object, missing: string[],
 *   unreadable: string[] }>} `complete` is true only when every field was read
 *   *and* had a value; `missing` names fields that do not exist; `unreadable`
 *   names fields whose read failed for any other reason.
 */
async function readCredentials(providerId, options = {}) {
    const provider = requireProvider(providerId);
    const values = {};
    const missing = [];
    const unreadable = [];

    for (const field of provider.secretFields) {
        let value = null;
        try {
            value = await readSecret(provider.id, field.name, options);
        } catch (error) {
            // Category only. A Secret Manager error names the resource, and the
            // resource name is not something to hand back to a caller.
            console.error(`[ai/credentials] Could not read ${provider.id}.${field.name}: ${error?.message || 'unknown'}`);
            unreadable.push(field.name);
            continue;
        }
        if (value) values[field.name] = value;
        else missing.push(field.name);
    }

    return {
        complete: missing.length === 0 && unreadable.length === 0,
        values,
        missing,
        unreadable,
    };
}

/**
 * Credentials plus the legacy fallback.
 *
 * Before migration, Groq's key exists only as the deploy-time `GROQ_API_KEY`
 * binding. Reading it here means the shared router serves production traffic
 * from the first deploy, and it stays as a rollback path afterwards: if the
 * migrated secret is destroyed or an operator rolls back, the old binding
 * still answers. `source` records which one was used so the console and
 * telemetry can show the truth.
 *
 * ### The fallback covers a failed read, not only an absent secret
 *
 * It originally triggered on `missing` alone, and that made it useless in the
 * failure mode it exists for. The migration promises a rollback path that needs
 * no code change — "destroy the managed credential and the router falls back" —
 * but the far likelier fault is the managed credential being *unreadable*: a
 * runtime service account without `secretAccessor`, which `readSecret`
 * deliberately surfaces as an error rather than as absence. That threw before
 * this function ever reached the fallback branch, so the deploy binding sat
 * there, working, and was never consulted. A safety net that only catches the
 * rarer of two falls is not a safety net.
 *
 * The managed credential still always wins when it can be read. `source`
 * distinguishes the two routes to the legacy binding so the console can say
 * which one is in play — a fallback after a read failure is a fault to fix, not
 * a migration state to leave alone.
 */
async function resolveCredentials(providerId, options = {}) {
    const resolved = await readCredentials(providerId, options);
    if (resolved.complete) {
        return { ...resolved, source: 'secret-manager' };
    }

    const apiKeyUnavailable = resolved.missing.includes('apiKey')
        || resolved.unreadable.includes('apiKey');
    if (providerId === 'groq' && apiKeyUnavailable) {
        const legacy = process.env.GROQ_API_KEY;
        if (legacy) {
            return {
                complete: true,
                values: { ...resolved.values, apiKey: legacy },
                missing: [],
                unreadable: [],
                source: resolved.unreadable.includes('apiKey')
                    ? 'legacy-env-after-read-failure'
                    : 'legacy-env',
            };
        }
    }

    return { ...resolved, source: null };
}

/** True when every required credential *and* every required config field is present. */
async function isConfigured(providerId, options = {}) {
    const provider = requireProvider(providerId);
    const credentials = await resolveCredentials(providerId, options);
    if (!credentials.complete) return false;

    const config = options.config || await readConfig(providerId);
    return provider.configFields
        .filter((field) => field.required)
        .every((field) => typeof config[field.name] === 'string' && config[field.name].trim());
}

async function saveCredential(providerId, fieldName, value, options = {}) {
    const provider = requireProvider(providerId);
    if (isRetired(provider)) {
        throw new Error(`${provider.displayName} has been retired and cannot be configured.`);
    }
    const result = await writeSecret(provider.id, fieldName, value, options);
    await configRef(provider.id).set({
        credentialUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return result;
}

async function deleteCredential(providerId, fieldName, options = {}) {
    const result = await destroySecretVersions(providerId, fieldName, options);
    await configRef(providerId).set({
        enabled: false,
        credentialUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return result;
}

/** Reveals exactly one credential. Callers must have already authorized. */
async function revealCredential(providerId, fieldName, options = {}) {
    const provider = requireProvider(providerId);
    const field = provider.secretFields.find((candidate) => candidate.name === fieldName);
    if (!field) throw new Error(`Unknown credential field "${String(fieldName)}".`);

    // A failed read must not deny an operator the legacy value, for the same
    // reason `resolveCredentials` consults it: the read failing is precisely the
    // situation in which the fallback matters.
    let value = null;
    let readFailed = false;
    try {
        value = await readSecret(provider.id, field.name, options);
    } catch (error) {
        console.error(`[ai/credentials] Could not reveal ${provider.id}.${field.name}: ${error?.message || 'unknown'}`);
        readFailed = true;
    }
    if (value) return { value, source: 'secret-manager' };

    if (provider.id === 'groq' && field.name === 'apiKey' && process.env.GROQ_API_KEY) {
        return {
            value: process.env.GROQ_API_KEY,
            source: readFailed ? 'legacy-env-after-read-failure' : 'legacy-env',
        };
    }
    return { value: null, source: null, unreadable: readFailed };
}

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
    COLLECTION,
    FAILURE_COOLDOWN_MS,
    QUOTA_COOLDOWN_MS,
    QUOTA_COOLDOWN_FLOOR_MS,
    QUOTA_COOLDOWN_BUFFER_MS,
    quotaCooldownMs,
    FAILURES_BEFORE_COOLDOWN,
    readConfig,
    readAllConfigs,
    writeConfig,
    readCredentials,
    resolveCredentials,
    revealCredential,
    isConfigured,
    saveCredential,
    deleteCredential,
    recordProviderOutcome,
    recordTestResult,
    summarizeCapabilities,
    MAX_STORED_CAPABILITIES,
    cooldownState,
    clearCooldown,
    worstLaneHealth,
};
