/**
 * Google Secret Manager, as SafeHaul's own run-time secrets use it: the AI
 * provider keys, the blog's media keys and the alerts bot token. Each caller
 * builds and guards its own secret names; this module only talks to the API.
 */

let clientPromise = null;

/** Lazy, so a test can inject a client without the library loading at all. */
function secretClient(injected) {
    if (injected) return Promise.resolve(injected);
    if (!clientPromise) {
        clientPromise = Promise.resolve().then(() => {
            const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
            return new SecretManagerServiceClient();
        });
    }
    return clientPromise;
}

function projectPath() {
    // Only variables already in the environment registry are read here;
    // `environmentRegistry.inventory.test.js` fails on any new one. The Functions
    // runtime injects GCLOUD_PROJECT and GCP_PROJECT; FIREBASE_PROJECT_ID is the
    // CI and local fallback.
    const id = process.env.GCLOUD_PROJECT
        || process.env.GCP_PROJECT
        || process.env.FIREBASE_PROJECT_ID;
    if (!id) throw new Error('Google Cloud project id is not available in this runtime.');
    return `projects/${id}`;
}

const secretPath = (secretId) => `${projectPath()}/secrets/${secretId}`;

/** gRPC NOT_FOUND, plus the FAILED_PRECONDITION a fully destroyed secret gives. */
function isNotFound(error) {
    return error?.code === 5 || error?.code === 9 || /NOT_FOUND/i.test(error?.message || '');
}

/**
 * The latest version's value, or null when the secret or its latest version
 * does not exist: a missing secret is "not configured yet", not an error.
 */
async function readLatestSecret(secretId, { client } = {}) {
    const api = await secretClient(client);
    try {
        const [version] = await api.accessSecretVersion({ name: `${secretPath(secretId)}/versions/latest` });
        const data = version?.payload?.data;
        return data ? Buffer.from(data).toString('utf8') : null;
    } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
    }
}

/**
 * Creates the secret if it is absent, then adds `value` as a new version. The
 * previous version stays, so a replacement can be rolled back until someone
 * destroys it.
 */
async function addSecretVersion(secretId, value, { labels, client } = {}) {
    const api = await secretClient(client);
    try {
        await api.createSecret({
            parent: projectPath(),
            secretId,
            secret: { replication: { automatic: {} }, labels },
        });
    } catch (error) {
        // ALREADY_EXISTS is the ordinary path for a replacement.
        if (error?.code !== 6 && !/ALREADY_EXISTS/i.test(error?.message || '')) throw error;
    }
    await api.addSecretVersion({
        parent: secretPath(secretId),
        payload: { data: Buffer.from(value, 'utf8') },
    });
}

/**
 * Destroys every version not destroyed yet and keeps the empty secret, so its
 * own history in Cloud Audit Logs stays intact. Returns how many it destroyed.
 */
async function destroyAllVersions(secretId, { client } = {}) {
    const api = await secretClient(client);
    let destroyed = 0;
    try {
        const [versions] = await api.listSecretVersions({ parent: secretPath(secretId) });
        for (const version of versions || []) {
            if (version.state === 'DESTROYED' || version.state === 4) continue;
            await api.destroySecretVersion({ name: version.name });
            destroyed += 1;
        }
    } catch (error) {
        if (!isNotFound(error)) throw error;
    }
    return destroyed;
}

module.exports = { readLatestSecret, addSecretVersion, destroyAllVersions, isNotFound };
