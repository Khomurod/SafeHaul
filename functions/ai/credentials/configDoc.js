// functions/ai/credentials/configDoc.js
//
// The Firestore side of the provider store: the non-secret config document
// per provider — enabled flags, model pins, health bookkeeping — and its
// read/write plumbing. No plaintext token is ever written here; secrets live
// in Secret Manager via `./secretManager`. Extracted verbatim from
// `store.js`.

const { admin, db } = require('../../firebaseAdmin');
const { requireProvider } = require('../registry/providers');


const COLLECTION = 'ai_provider_config';

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

module.exports = {
    COLLECTION,
    configRef,
    readConfig,
    readAllConfigs,
    writeConfig,
};
