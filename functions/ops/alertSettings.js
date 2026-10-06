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

const TOKEN_SECRET_ID = 'SAFEHAUL_AI_ALERTS_TELEGRAM_BOTTOKEN';
const SETTINGS_PATH = Object.freeze(['system_jobs', 'platformAlerts']);
const CACHE_TTL_MS = 60 * 1000;

let cached = null;
let clientPromise = null;

function getClient(injected) {
    if (injected) return Promise.resolve(injected);
    if (!clientPromise) {
        clientPromise = Promise.resolve().then(() => {
            const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
            return new SecretManagerServiceClient();
        });
    }
    return clientPromise;
}

function secretPath() {
    const id = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.FIREBASE_PROJECT_ID;
    if (!id) throw new Error('Google Cloud project id is not available in this runtime.');
    return `projects/${id}/secrets/${TOKEN_SECRET_ID}`;
}

function isNotFound(error) {
    return error?.code === 5 || error?.code === 9 || /NOT_FOUND/i.test(error?.message || '');
}

/** The bot token, or null when none is saved. */
async function readBotToken({ client: injected } = {}) {
    if (cached && Date.now() < cached.expiresAt) return cached.value;
    const client = await getClient(injected);
    try {
        const [version] = await client.accessSecretVersion({ name: `${secretPath()}/versions/latest` });
        const data = version?.payload?.data;
        const value = data ? Buffer.from(data).toString('utf8') : null;
        cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
        return value;
    } catch (error) {
        if (!isNotFound(error)) throw error;
        cached = { value: null, expiresAt: Date.now() + CACHE_TTL_MS };
        return null;
    }
}

async function writeBotToken(value, { client: injected } = {}) {
    const client = await getClient(injected);
    const name = secretPath();
    try {
        await client.createSecret({
            parent: name.replace(/\/secrets\/.*$/, ''),
            secretId: TOKEN_SECRET_ID,
            secret: {
                replication: { automatic: {} },
                labels: { managed_by: 'safehaul', surface: 'platform_alerts' },
            },
        });
    } catch (error) {
        // ALREADY_EXISTS is the ordinary path for a replacement.
        if (error?.code !== 6 && !/ALREADY_EXISTS/i.test(error?.message || '')) throw error;
    }
    await client.addSecretVersion({ parent: name, payload: { data: Buffer.from(value, 'utf8') } });
    cached = null;
    return { secretId: TOKEN_SECRET_ID, valueLength: value.length };
}

/** Destroys every version and keeps the empty container, as the AI credentials do. */
async function destroyBotToken({ client: injected } = {}) {
    const client = await getClient(injected);
    let destroyed = 0;
    try {
        const [versions] = await client.listSecretVersions({ parent: secretPath() });
        for (const version of versions || []) {
            if (version.state === 'DESTROYED' || version.state === 4) continue;
            await client.destroySecretVersion({ name: version.name });
            destroyed += 1;
        }
    } catch (error) {
        if (!isNotFound(error)) throw error;
    }
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

function clearTokenCache() {
    cached = null;
}

module.exports = {
    TOKEN_SECRET_ID,
    SETTINGS_PATH,
    readBotToken,
    writeBotToken,
    destroyBotToken,
    readSettings,
    replaceSettings,
    clearTokenCache,
};
