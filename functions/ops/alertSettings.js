/**
 * Where the operator alerts keep their settings: the bot token, and everything
 * else.
 *
 * - **The token** is a credential. It goes to Secret Manager under one fixed
 *   name in the `SAFEHAUL_AI_*` namespace, which the Functions runtime accounts
 *   can already create, read and destroy (`docs/ai-platform.md`, IAM). A browser
 *   never names it, and no response or log carries it.
 * - **Everything else** (the bot's name, the connected chat, what the watcher saw
 *   last) is in `system_jobs/platformAlerts`. `system_jobs` has no Firestore
 *   rule, so clients are default-denied, as for `publicProfileReconcile`.
 */

const { db } = require('../firebaseAdmin');
const secretStore = require('../shared/secretStore');

const TOKEN_SECRET_ID = 'SAFEHAUL_AI_ALERTS_TELEGRAM_BOTTOKEN';
const SETTINGS_PATH = Object.freeze(['system_jobs', 'platformAlerts']);
const CACHE_TTL_MS = 60 * 1000;

let cached = null;

/** The bot token, or null when none is saved. */
async function readBotToken({ client } = {}) {
    if (cached && Date.now() < cached.expiresAt) return cached.value;
    const value = await secretStore.readLatestSecret(TOKEN_SECRET_ID, { client });
    cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
}

async function writeBotToken(value, { client } = {}) {
    await secretStore.addSecretVersion(TOKEN_SECRET_ID, value, {
        client,
        labels: { managed_by: 'safehaul', surface: 'platform_alerts' },
    });
    cached = null;
    return { secretId: TOKEN_SECRET_ID, valueLength: value.length };
}

/** Destroys every version and keeps the empty container, as the AI credentials do. */
async function destroyBotToken({ client } = {}) {
    const destroyed = await secretStore.destroyAllVersions(TOKEN_SECRET_ID, { client });
    cached = null;
    return { secretId: TOKEN_SECRET_ID, destroyed };
}

function settingsRef() {
    return db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]);
}

async function readSettings() {
    const snapshot = await settingsRef().get();
    return snapshot.exists ? snapshot.data() || {} : {};
}

/**
 * Replaces the named top-level fields whole and leaves the rest: the connection
 * (`telegram`) and the watcher's state (`watch`) are written by different paths
 * and must never overwrite each other, while a replaced token must take the old
 * bot's chat with it.
 */
async function replaceSettings(patch) {
    await settingsRef().set(patch, { mergeFields: Object.keys(patch) });
}

/**
 * `replaceSettings`, but only while the stored settings still pass `stillCurrent`,
 * checked and written in one transaction. The patch is built from what the
 * transaction read, so a request that started before a Remove or a Replace
 * token cannot write its stale copy of the connection back over the new one.
 *
 * @param {(stored: object) => boolean} stillCurrent
 * @param {(stored: object) => object} buildPatch the top-level fields to replace
 * @returns {Promise<boolean>} whether it was written
 */
async function replaceSettingsIf(stillCurrent, buildPatch) {
    const ref = settingsRef();
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const stored = snapshot.exists ? snapshot.data() || {} : {};
        if (!stillCurrent(stored)) return false;
        const patch = buildPatch(stored);
        transaction.set(ref, patch, { mergeFields: Object.keys(patch) });
        return true;
    });
}

module.exports = {
    TOKEN_SECRET_ID,
    SETTINGS_PATH,
    readBotToken,
    writeBotToken,
    destroyBotToken,
    readSettings,
    replaceSettings,
    replaceSettingsIf,
};
