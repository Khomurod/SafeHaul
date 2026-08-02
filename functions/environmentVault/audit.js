/**
 * Immutable, server-written audit trail for the Super Admin Environment &
 * Integrations vault.
 *
 * Every list, reveal and mutation writes one document to `environment_audit_log`.
 * The collection has no Firestore rule match, so no client can read or write it
 * directly — it is Admin-SDK only, and the vault surfaces recent activity
 * through `listEnvironmentAndIntegrations` instead.
 *
 * ## What is deliberately never recorded
 *
 * Plaintext, ciphertext, partial values, token fragments, passwords and private
 * keys. `sanitizeMetadata` below is a hard filter, not a convention: it accepts
 * an explicit allowlist of scalar fields and drops everything else, so a future
 * caller cannot accidentally widen the record by passing an extra property.
 */

const { admin, db } = require('../firebaseAdmin');

const AUDIT_COLLECTION = 'environment_audit_log';

const ACTIONS = Object.freeze({
    LIST: 'list',
    REVEAL: 'reveal',
    UPDATE: 'update',
    ADD: 'add',
    DELETE: 'delete',
    TEST: 'test',
});

const RESULTS = Object.freeze({
    SUCCESS: 'success',
    DENIED: 'denied',
    FAILED: 'failed',
    UNAVAILABLE: 'unavailable',
});

/**
 * Fields an audit record may carry. Anything not listed here is dropped.
 * Every one of these is metadata about *which* key was touched — never about
 * what the key contains.
 */
const ALLOWED_METADATA = Object.freeze([
    'entryId',
    'key',
    'integration',
    'scope',
    'companyId',
    'source',
    'category',
    'sensitivity',
    'availability',
    'field',
    'documentPath',
    'entryCount',
    'valueLength',
    'reason',
    // AI Integrations shares this audit trail rather than starting a second
    // one. These name *which* provider and setting were touched; none of them
    // can carry a credential value.
    'providerId',
    'capability',
    'enabled',
    'setting',
]);

/** Coerces a metadata value to a small, safe scalar. */
function safeScalar(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'boolean') return value;
    const text = String(value);
    // Identifiers and paths are short. Anything longer is not an identifier and
    // has no business in an audit record.
    return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/**
 * Reduces arbitrary caller metadata to the allowlisted, value-free subset.
 *
 * `valueLength` is the one numeric fact about a value that is recorded. A length
 * alone is not a token fragment and cannot be used to reconstruct a secret, and
 * it is what makes "the update actually changed something" auditable.
 *
 * @param {object} [metadata]
 * @returns {object}
 */
function sanitizeMetadata(metadata = {}) {
    const out = {};
    for (const field of ALLOWED_METADATA) {
        if (metadata[field] === undefined) continue;
        out[field] = safeScalar(metadata[field]);
    }
    return out;
}

/**
 * Writes one audit record. Never throws: an audit write failing must not turn a
 * successful administrative action into an error, and must not turn a denial
 * into a success either.
 *
 * @param {object} params
 * @param {object|null} params.auth Callable `request.auth`, or null.
 * @param {string} params.action One of `ACTIONS`.
 * @param {string} params.result One of `RESULTS`.
 * @param {object} [params.metadata] Value-free metadata; filtered by the allowlist.
 */
async function recordAuditEvent({ auth, action, result, metadata }) {
    const actorUid = auth?.uid || null;
    const rawEmail = auth?.token?.email;
    const actorEmail = typeof rawEmail === 'string' && rawEmail.includes('@') ? rawEmail : null;

    const record = {
        actorUid,
        actorEmail,
        action,
        result,
        ...sanitizeMetadata(metadata),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    try {
        await db.collection(AUDIT_COLLECTION).add(record);
    } catch (error) {
        // Structured, value-free: the record itself contains no secret, but the
        // error path must not echo the attempted document either.
        console.error('[environmentVault] audit write failed', {
            action,
            result,
            message: error?.message || 'unknown',
        });
    }
}

/**
 * Reads the most recent audit records for the activity panel.
 * Returns plain, serialisable rows — never a value, because none was stored.
 *
 * @param {number} [limit=20]
 */
async function readRecentActivity(limit = 20) {
    try {
        const snapshot = await db
            .collection(AUDIT_COLLECTION)
            .orderBy('timestamp', 'desc')
            .limit(Math.min(Math.max(Number(limit) || 20, 1), 50))
            .get();

        return snapshot.docs.map((doc) => {
            const data = doc.data() || {};
            const timestamp = data.timestamp && typeof data.timestamp.toMillis === 'function'
                ? data.timestamp.toMillis()
                : null;
            return {
                id: doc.id,
                actorUid: data.actorUid || null,
                actorEmail: data.actorEmail || null,
                action: data.action || null,
                result: data.result || null,
                key: data.key || null,
                entryId: data.entryId || null,
                integration: data.integration || null,
                scope: data.scope || null,
                companyId: data.companyId || null,
                source: data.source || null,
                reason: data.reason || null,
                timestamp,
            };
        });
    } catch (error) {
        console.warn('[environmentVault] recent activity unavailable', {
            message: error?.message || 'unknown',
        });
        return [];
    }
}

module.exports = {
    ACTIONS,
    AUDIT_COLLECTION,
    RESULTS,
    ALLOWED_METADATA,
    readRecentActivity,
    recordAuditEvent,
    sanitizeMetadata,
};
