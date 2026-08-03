/**
 * AI operational telemetry.
 *
 * Records enough to answer "which provider is actually working right now" and
 * nothing that could answer "what was in that document".
 *
 * Recorded: task type, provider, model, outcome category, latency, fallback
 * count, cooldown state, timestamp.
 *
 * Never recorded: credentials, prompts, CDL or document images, provider
 * response text, personal data, or article drafts. The allowlist below is the
 * enforcement mechanism — anything not named is dropped rather than trusted.
 */

const { admin, db } = require('../../firebaseAdmin');

const COLLECTION = 'ai_telemetry';

/** Retained for 30 days by a Firestore TTL policy on `expiresAt`. */
const RETENTION_DAYS = 30;

const ALLOWED_FIELDS = Object.freeze([
    'taskType',
    'capability',
    'providerId',
    'model',
    'outcome',
    'category',
    'latencyMs',
    'fallbackCount',
    'attemptedProviders',
    'cooldownSkipped',
    'credentialSource',
]);

function sanitize(entry) {
    const clean = {};
    for (const key of ALLOWED_FIELDS) {
        const value = entry[key];
        if (value === undefined || value === null) continue;
        if (typeof value === 'string') {
            clean[key] = value.slice(0, 120);
        } else if (typeof value === 'number' && Number.isFinite(value)) {
            clean[key] = value;
        } else if (typeof value === 'boolean') {
            clean[key] = value;
        } else if (Array.isArray(value)) {
            // Provider ids only, capped, so a long fallback chain cannot bloat
            // the document.
            clean[key] = value.slice(0, 12).map((item) => String(item).slice(0, 40));
        }
    }
    return clean;
}

/**
 * Writes one telemetry row. Never throws: a telemetry failure must not turn a
 * successful AI call into an error, nor hide a real one.
 */
async function recordAiTelemetry(entry) {
    try {
        const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
        await db.collection(COLLECTION).add({
            ...sanitize(entry || {}),
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt,
        });
    } catch (error) {
        console.error(`[ai/telemetry] Could not record telemetry: ${error?.message}`);
    }
}

/**
 * Recent rows for the Super Admin console. Returns `[]` on error rather than
 * failing the page — telemetry is diagnostic, not load-bearing.
 */
async function readRecentTelemetry(limit = 25) {
    const capped = Math.max(1, Math.min(Number(limit) || 25, 100));
    try {
        const snapshot = await db.collection(COLLECTION)
            .orderBy('timestamp', 'desc')
            .limit(capped)
            .get();
        return snapshot.docs.map((doc) => {
            const data = doc.data() || {};
            return {
                id: doc.id,
                ...sanitize(data),
                timestamp: data.timestamp?.toDate?.()?.toISOString() || null,
            };
        });
    } catch (error) {
        console.error(`[ai/telemetry] Could not read telemetry: ${error?.message}`);
        return [];
    }
}

module.exports = { COLLECTION, ALLOWED_FIELDS, RETENTION_DAYS, recordAiTelemetry, readRecentTelemetry, sanitize };
