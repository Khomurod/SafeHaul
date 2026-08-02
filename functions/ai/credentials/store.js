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
 * @returns {Promise<{ complete: boolean, values: object, missing: string[] }>}
 */
async function readCredentials(providerId, options = {}) {
    const provider = requireProvider(providerId);
    const values = {};
    const missing = [];

    for (const field of provider.secretFields) {
        const value = await readSecret(provider.id, field.name, options);
        if (value) values[field.name] = value;
        else missing.push(field.name);
    }

    return { complete: missing.length === 0, values, missing };
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
 */
async function resolveCredentials(providerId, options = {}) {
    const resolved = await readCredentials(providerId, options);
    if (resolved.complete) {
        return { ...resolved, source: 'secret-manager' };
    }

    if (providerId === 'groq' && resolved.missing.includes('apiKey')) {
        const legacy = process.env.GROQ_API_KEY;
        if (legacy) {
            return {
                complete: true,
                values: { ...resolved.values, apiKey: legacy },
                missing: [],
                source: 'legacy-env',
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

    const value = await readSecret(provider.id, field.name, options);
    if (value) return { value, source: 'secret-manager' };

    if (provider.id === 'groq' && field.name === 'apiKey' && process.env.GROQ_API_KEY) {
        return { value: process.env.GROQ_API_KEY, source: 'legacy-env' };
    }
    return { value: null, source: null };
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
async function recordProviderOutcome(providerId, outcome) {
    const { success, category } = outcome;
    const now = Date.now();
    const update = {
        lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (success) {
        update.consecutiveFailures = 0;
        update.cooldownUntil = admin.firestore.FieldValue.delete();
        update.cooldownReason = admin.firestore.FieldValue.delete();
        update.lastSuccessAt = admin.firestore.FieldValue.serverTimestamp();
        update.health = 'healthy';
    } else {
        const current = await readConfig(providerId).catch(() => ({}));
        const failures = Number(current.consecutiveFailures || 0) + 1;
        update.consecutiveFailures = failures;
        update.lastFailureCategory = typeof category === 'string' ? category.slice(0, 40) : 'internal';
        update.health = 'degraded';

        const quotaFailure = category === 'quota_exceeded' || category === 'rate_limited';
        if (quotaFailure) {
            update.cooldownUntil = now + QUOTA_COOLDOWN_MS;
            update.cooldownReason = 'quota';
            update.health = 'quota';
        } else if (failures >= FAILURES_BEFORE_COOLDOWN) {
            update.cooldownUntil = now + FAILURE_COOLDOWN_MS;
            update.cooldownReason = 'failures';
        }
    }

    try {
        await configRef(providerId).set(update, { merge: true });
    } catch (error) {
        // Health bookkeeping must never turn a successful AI call into a
        // failure, nor mask a real one.
        console.error(`[ai/credentials] Could not record outcome for ${providerId}: ${error?.message}`);
    }
}

function cooldownState(config, now = Date.now()) {
    const until = Number(config?.cooldownUntil || 0);
    if (!until || until <= now) return { active: false, until: null, reason: null };
    return { active: true, until, reason: config.cooldownReason || 'failures' };
}

async function clearCooldown(providerId) {
    await configRef(providerId).set({
        cooldownUntil: admin.firestore.FieldValue.delete(),
        cooldownReason: admin.firestore.FieldValue.delete(),
        consecutiveFailures: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

async function recordTestResult(providerId, result) {
    await configRef(providerId).set({
        lastTestAt: admin.firestore.FieldValue.serverTimestamp(),
        lastTestSuccess: Boolean(result?.success),
        lastTestCategory: result?.success ? null : (result?.category || 'internal'),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

module.exports = {
    COLLECTION,
    FAILURE_COOLDOWN_MS,
    QUOTA_COOLDOWN_MS,
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
    cooldownState,
    clearCooldown,
};
