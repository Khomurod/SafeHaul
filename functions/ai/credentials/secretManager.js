/**
 * Google Secret Manager access for AI provider credentials.
 *
 * Three properties make this safe to expose behind a Super Admin console:
 *
 *  1. **Secret names are derived, never supplied.** A name is built from a
 *     provider row that was looked up in the frozen registry plus a field
 *     declared on that row. A browser can pass `providerId` and `field`, but
 *     both are resolved through the registry first, so no request can name an
 *     arbitrary secret. `assertSafehaulAiSecret` is a second, independent
 *     check on the final string.
 *  2. **Runtime access, not deploy-time binding.** Credentials are read with
 *     the Secret Manager client rather than `secrets: [...]` bindings, because
 *     a binding to a secret that does not exist yet fails the whole functions
 *     deploy. Adding a tenth provider must not require a redeploy, and an
 *     operator adding their first Mistral key must not break CI.
 *  3. **Nothing is cached to disk.** Values live in a short-TTL in-process
 *     cache and nowhere else.
 */

const { requireProvider } = require('../registry/providers');

/** Every SafeHaul-owned AI secret starts with this. Nothing else is readable. */
const SECRET_PREFIX = 'SAFEHAUL_AI_';

/** Final-gate pattern for a resolved secret id. */
const SECRET_ID_PATTERN = /^SAFEHAUL_AI_[A-Z0-9_]{1,80}$/;

/**
 * In-process cache. Cloud Functions instances are short-lived and a cold read
 * costs a Secret Manager round trip on every AI call otherwise. Sixty seconds
 * is short enough that a rotation propagates within a minute.
 */
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

let clientPromise = null;

/** Lazy so unit tests can inject a client without the library loading at all. */
function getClient(injected) {
    if (injected) return Promise.resolve(injected);
    if (!clientPromise) {
        clientPromise = Promise.resolve().then(() => {
            // Required lazily: the module is only needed when a real credential
            // read happens, and every test injects a fake instead.
            const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
            return new SecretManagerServiceClient();
        });
    }
    return clientPromise;
}

function projectId() {
    // Only variables already carried in the environment registry are read
    // here; `environmentRegistry.inventory.test.js` fails on any new one.
    // GCLOUD_PROJECT and GCP_PROJECT are both injected by the Functions
    // runtime; FIREBASE_PROJECT_ID is the CI/local fallback.
    const id = process.env.GCLOUD_PROJECT
        || process.env.GCP_PROJECT
        || process.env.FIREBASE_PROJECT_ID;
    if (!id) throw new Error('Google Cloud project id is not available in this runtime.');
    return id;
}

/** `github-models` + `token` → `SAFEHAUL_AI_GITHUB_MODELS_TOKEN`. */
function buildSecretId(providerId, fieldName) {
    const provider = requireProvider(providerId);
    const field = provider.secretFields.find((candidate) => candidate.name === fieldName);
    if (!field) {
        throw new Error(`Provider "${provider.id}" has no credential field "${String(fieldName)}".`);
    }
    const providerPart = provider.id.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    const fieldPart = field.name.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    return `${SECRET_PREFIX}${providerPart}_${fieldPart}`;
}

/**
 * Independent verification that a resolved id is inside SafeHaul's AI
 * namespace. `buildSecretId` should make this unreachable; it exists so that a
 * future refactor cannot quietly widen access to arbitrary project secrets.
 */
function assertSafehaulAiSecret(secretId) {
    if (!SECRET_ID_PATTERN.test(secretId)) {
        throw new Error('Refusing to access a secret outside the SafeHaul AI namespace.');
    }
    return secretId;
}

function secretPath(secretId) {
    return `projects/${projectId()}/secrets/${assertSafehaulAiSecret(secretId)}`;
}

function cacheKey(secretId) {
    return secretId;
}

function readCache(secretId) {
    const entry = cache.get(cacheKey(secretId));
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        cache.delete(cacheKey(secretId));
        return undefined;
    }
    return entry.value;
}

function writeCache(secretId, value) {
    cache.set(cacheKey(secretId), { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function clearCache(secretId) {
    if (secretId) cache.delete(cacheKey(secretId));
    else cache.clear();
}

/**
 * Reads the latest enabled version of a credential.
 *
 * @returns {Promise<string|null>} the value, or null when the secret or its
 *   latest version does not exist. A missing secret is an ordinary
 *   "not configured yet" state, not an error.
 */
async function readSecret(providerId, fieldName, { client: injected } = {}) {
    const secretId = buildSecretId(providerId, fieldName);
    const cached = readCache(secretId);
    if (cached !== undefined) return cached;

    const client = await getClient(injected);
    try {
        const [version] = await client.accessSecretVersion({
            name: `${secretPath(secretId)}/versions/latest`,
        });
        const payload = version?.payload?.data;
        const value = payload ? Buffer.from(payload).toString('utf8') : null;
        writeCache(secretId, value);
        return value;
    } catch (error) {
        if (isNotFound(error)) {
            writeCache(secretId, null);
            return null;
        }
        throw error;
    }
}

/** gRPC NOT_FOUND, plus the FAILED_PRECONDITION a fully-destroyed secret gives. */
function isNotFound(error) {
    return error?.code === 5 || error?.code === 9 || /NOT_FOUND/i.test(error?.message || '');
}

/**
 * Creates the secret if absent, then adds a new version.
 *
 * Adding a version rather than replacing in place is what makes the Groq
 * migration reversible: the previous version stays available for rollback
 * until an operator explicitly destroys it.
 */
async function writeSecret(providerId, fieldName, value, { client: injected } = {}) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error('A credential value is required.');
    }
    const secretId = buildSecretId(providerId, fieldName);
    const client = await getClient(injected);
    const parent = `projects/${projectId()}`;

    try {
        await client.createSecret({
            parent,
            secretId,
            secret: {
                replication: { automatic: {} },
                labels: { managed_by: 'safehaul', surface: 'ai_integrations' },
            },
        });
    } catch (error) {
        // ALREADY_EXISTS is the normal path for a replacement.
        if (error?.code !== 6 && !/ALREADY_EXISTS/i.test(error?.message || '')) throw error;
    }

    await client.addSecretVersion({
        parent: secretPath(secretId),
        payload: { data: Buffer.from(value, 'utf8') },
    });

    clearCache(secretId);
    return { secretId, valueLength: value.length };
}

/**
 * Destroys every enabled version, leaving the (now empty) secret container.
 *
 * Destroying versions rather than deleting the secret keeps the resource's own
 * audit history in Cloud Audit Logs intact, which is the point of a value-free
 * audit trail.
 */
async function destroySecretVersions(providerId, fieldName, { client: injected } = {}) {
    const secretId = buildSecretId(providerId, fieldName);
    const client = await getClient(injected);
    let destroyed = 0;

    try {
        const [versions] = await client.listSecretVersions({ parent: secretPath(secretId) });
        for (const version of versions || []) {
            if (version.state === 'DESTROYED' || version.state === 4) continue;
            await client.destroySecretVersion({ name: version.name });
            destroyed += 1;
        }
    } catch (error) {
        if (!isNotFound(error)) throw error;
    }

    clearCache(secretId);
    return { secretId, destroyed };
}

module.exports = {
    SECRET_PREFIX,
    SECRET_ID_PATTERN,
    buildSecretId,
    assertSafehaulAiSecret,
    readSecret,
    writeSecret,
    destroySecretVersions,
    clearCache,
    __test: { isNotFound, CACHE_TTL_MS },
};
