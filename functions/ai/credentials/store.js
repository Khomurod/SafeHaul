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

const { admin } = require('../../firebaseAdmin');
const { requireProvider, isRetired } = require('../registry/providers');
const { readSecret, writeSecret, destroySecretVersions } = require('./secretManager');
const {
    COLLECTION,
    configRef,
    readConfig,
    readAllConfigs,
    writeConfig,
} = require('./configDoc');
const {
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
} = require('./health');

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
