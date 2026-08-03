/**
 * Media provider credentials.
 *
 * Reuses the AI platform's Secret Manager naming discipline rather than
 * inventing a second scheme: names are derived from the frozen provider table
 * in `./imageProviders.js`, so a browser can never name a secret here either.
 * Media keys live under the `SAFEHAUL_AI_MEDIA_*` prefix, inside the same
 * SafeHaul-owned namespace the AI credential guard already enforces.
 */

const { PROVIDERS, PROVIDERS_BY_ID } = require('./imageProviders');

const PREFIX = 'SAFEHAUL_AI_MEDIA_';
const SECRET_ID_PATTERN = /^SAFEHAUL_AI_MEDIA_[A-Z0-9_]{1,60}$/;

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

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

function projectId() {
    const id = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.FIREBASE_PROJECT_ID;
    if (!id) throw new Error('Google Cloud project id is not available in this runtime.');
    return id;
}

/** `unsplash` + `accessKey` → `SAFEHAUL_AI_MEDIA_UNSPLASH_ACCESSKEY`. */
function buildMediaSecretId(providerId, fieldName) {
    const provider = PROVIDERS_BY_ID.get(providerId);
    if (!provider) throw new Error(`Unknown media provider "${String(providerId)}".`);
    const field = provider.secretFields.find((candidate) => candidate.name === fieldName);
    if (!field) throw new Error(`Provider "${provider.id}" has no credential field "${String(fieldName)}".`);

    const id = `${PREFIX}${provider.id.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`
        + `_${field.name.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
    if (!SECRET_ID_PATTERN.test(id)) {
        throw new Error('Refusing to access a secret outside the SafeHaul media namespace.');
    }
    return id;
}

async function readMediaSecret(providerId, fieldName, { client: injected } = {}) {
    const secretId = buildMediaSecretId(providerId, fieldName);
    const cached = cache.get(secretId);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    const client = await getClient(injected);
    try {
        const [version] = await client.accessSecretVersion({
            name: `projects/${projectId()}/secrets/${secretId}/versions/latest`,
        });
        const data = version?.payload?.data;
        const value = data ? Buffer.from(data).toString('utf8') : null;
        cache.set(secretId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        return value;
    } catch (error) {
        if (error?.code === 5 || error?.code === 9 || /NOT_FOUND/i.test(error?.message || '')) {
            cache.set(secretId, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
            return null;
        }
        throw error;
    }
}

async function writeMediaSecret(providerId, fieldName, value, { client: injected } = {}) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('A credential value is required.');
    const secretId = buildMediaSecretId(providerId, fieldName);
    const client = await getClient(injected);

    try {
        await client.createSecret({
            parent: `projects/${projectId()}`,
            secretId,
            secret: {
                replication: { automatic: {} },
                labels: { managed_by: 'safehaul', surface: 'ai_integrations_media' },
            },
        });
    } catch (error) {
        if (error?.code !== 6 && !/ALREADY_EXISTS/i.test(error?.message || '')) throw error;
    }

    await client.addSecretVersion({
        parent: `projects/${projectId()}/secrets/${secretId}`,
        payload: { data: Buffer.from(value, 'utf8') },
    });

    cache.delete(secretId);
    return { secretId, valueLength: value.length };
}

async function destroyMediaSecret(providerId, fieldName, { client: injected } = {}) {
    const secretId = buildMediaSecretId(providerId, fieldName);
    const client = await getClient(injected);
    let destroyed = 0;

    try {
        const [versions] = await client.listSecretVersions({
            parent: `projects/${projectId()}/secrets/${secretId}`,
        });
        for (const version of versions || []) {
            if (version.state === 'DESTROYED' || version.state === 4) continue;
            await client.destroySecretVersion({ name: version.name });
            destroyed += 1;
        }
    } catch (error) {
        if (error?.code !== 5 && !/NOT_FOUND/i.test(error?.message || '')) throw error;
    }

    cache.delete(secretId);
    return { secretId, destroyed };
}

/**
 * Every configured media provider's credentials.
 *
 * @returns {Promise<Map<string, object>>} provider id → credential values.
 *   A provider with no credentials is simply absent, which is how the image
 *   search knows to skip it.
 */
async function readAllMediaCredentials(options = {}) {
    const byProvider = new Map();

    for (const provider of PROVIDERS) {
        const values = {};
        for (const field of provider.secretFields) {
            // eslint-disable-next-line no-await-in-loop
            const value = await readMediaSecret(provider.id, field.name, options).catch(() => null);
            if (value) values[field.name] = value;
        }
        if (Object.keys(values).length > 0) byProvider.set(provider.id, values);
    }

    return byProvider;
}

function clearCache() {
    cache.clear();
}

module.exports = {
    PREFIX,
    SECRET_ID_PATTERN,
    buildMediaSecretId,
    readMediaSecret,
    writeMediaSecret,
    destroyMediaSecret,
    readAllMediaCredentials,
    clearCache,
};
