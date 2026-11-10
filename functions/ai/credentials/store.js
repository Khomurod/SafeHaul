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
 * Secret Manager is the only credential source: no function reads a deploy-time
 * binding as a fallback.
 */

const { admin } = require('../../firebaseAdmin');
const { requireProvider } = require('../registry/providers');
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
    versionRestKey,
    restingModels,
    hasVersionRest,
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
 * Credentials plus the source they came from: `'secret-manager'` when every
 * field was read and had a value, otherwise `null`. Telemetry records `source`
 * per request.
 */
async function resolveCredentials(providerId, options = {}) {
    const resolved = await readCredentials(providerId, options);
    return { ...resolved, source: resolved.complete ? 'secret-manager' : null };
}

async function saveCredential(providerId, fieldName, value, options = {}) {
    const provider = requireProvider(providerId);
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

    let value = null;
    let readFailed = false;
    try {
        value = await readSecret(provider.id, field.name, options);
    } catch (error) {
        console.error(`[ai/credentials] Could not reveal ${provider.id}.${field.name}: ${error?.message || 'unknown'}`);
        readFailed = true;
    }
    if (value) return { value, source: 'secret-manager' };
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
    saveCredential,
    deleteCredential,
    recordProviderOutcome,
    recordTestResult,
    summarizeCapabilities,
    MAX_STORED_CAPABILITIES,
    cooldownState,
    clearCooldown,
    versionRestKey,
    restingModels,
    hasVersionRest,
    worstLaneHealth,
};
