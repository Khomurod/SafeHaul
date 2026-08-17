/**
 * AI operational telemetry.
 *
 * Records enough to answer "what happened to this request, and why" and nothing
 * that could answer "what was in that document".
 *
 * ## One document per transaction
 *
 * A single AI request may try several providers. This used to record exactly one
 * row per task — written on final success or terminal failure — so the
 * intermediate attempts existed nowhere: a fallback chain's individual failures
 * survived only inside the `all_providers_failed` message string and as counters
 * on `ai_provider_config`. An operator could see that CDL extraction failed and
 * not which providers were tried, in what order, or why each declined.
 *
 * Now one document carries the whole transaction, with a bounded `attempts`
 * array describing each provider's turn. One read reconstructs the timeline, and
 * one TTL expiry disposes of it.
 *
 * ## The allowlist is the privacy mechanism
 *
 * Never recorded: credentials, prompts, CDL or document images, provider
 * response text, extracted personal data, or article drafts. The allowlists
 * below are the enforcement — anything not named is dropped rather than trusted,
 * at both the transaction level and inside each attempt.
 *
 * That matters more here than it did before, because attempts carry vendor
 * diagnostics. Several vendors echo the submitted prompt back inside their error
 * strings, which is why an attempt records a normalized category, an HTTP status
 * and a *pattern-checked* vendor code — never an error message or body.
 */

const { admin, db } = require('../../firebaseAdmin');

const COLLECTION = 'ai_telemetry';

/** Retained for 30 days by a Firestore TTL policy on `expiresAt`. */
const RETENTION_DAYS = 30;

/**
 * Ceiling on recorded attempts.
 *
 * Nine providers, plus the one retry the registry grants Hugging Face and the
 * single vendor-stated wait the router may honour. Twelve covers the longest
 * legitimate chain with room to spare, and bounds the document against a loop.
 */
const MAX_ATTEMPTS = 12;

const ALLOWED_FIELDS = Object.freeze([
    // Correlation. One id per `runAiTask` call, returned to the caller so a
    // callable's own log line can name the transaction an operator is reading.
    'transactionId',
    'taskType',
    'capability',
    'requiredCapabilities',
    'providerId',
    'model',
    'outcome',
    'category',
    'latencyMs',
    'fallbackCount',
    'attemptedProviders',
    'providersInvolved',
    'cooldownSkipped',
    'credentialSource',
    // A metadata-only description of the request. See `describeTaskInput`.
    'inputSummary',
]);

/**
 * What may be kept about one provider's turn.
 *
 * Everything here is either a number, an enumerated category from SafeHaul's own
 * taxonomy, or a vendor code that has passed `VENDOR_CODE_PATTERN`. There is
 * deliberately no field for an error message, an error body, a request or a
 * response.
 */
const ALLOWED_ATTEMPT_FIELDS = Object.freeze([
    'providerId',
    'model',
    'attemptNumber',
    // 'attempted' | 'skipped'
    'status',
    'skipReason',
    'success',
    // SafeHaul's normalized failure category, e.g. `quota_exceeded`.
    'category',
    'vendorCode',
    'httpStatus',
    'latencyMs',
    'retryAfterMs',
    // Whether the provider's output survived SafeHaul's own schema validation.
    'schemaValid',
    'inputTokens',
    'outputTokens',
    // Which provider the router moved on to, so the chain reads in order.
    'nextProviderId',
]);

/**
 * A vendor error *code* is safe; a vendor error *message* is not.
 *
 * Codes are short machine identifiers from a closed vocabulary —
 * `model_not_found`, `rate_limit_exceeded`, `insufficient_quota`. Messages are
 * free prose, and several vendors quote the submitted prompt back inside them,
 * which on the CDL path means quoting the licence.
 *
 * This pattern is what separates the two. Anything with a space, a quote, a
 * newline or any length is not a code and is dropped.
 */
const VENDOR_CODE_PATTERN = /^[a-z0-9_.-]{1,64}$/i;

function safeString(value, max) {
    return String(value).slice(0, max);
}

function sanitizeAttempt(attempt) {
    const clean = {};
    for (const key of ALLOWED_ATTEMPT_FIELDS) {
        const value = attempt?.[key];
        if (value === undefined || value === null) continue;

        if (key === 'vendorCode') {
            // Positively validated, not merely truncated. A truncated error
            // message is still an error message.
            if (typeof value === 'string' && VENDOR_CODE_PATTERN.test(value)) {
                clean[key] = value;
            }
            continue;
        }

        if (typeof value === 'string') clean[key] = safeString(value, 120);
        else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
        else if (typeof value === 'boolean') clean[key] = value;
    }
    return clean;
}

function sanitize(entry) {
    const clean = {};
    for (const key of ALLOWED_FIELDS) {
        const value = entry[key];
        if (value === undefined || value === null) continue;
        if (typeof value === 'string') {
            clean[key] = safeString(value, 200);
        } else if (typeof value === 'number' && Number.isFinite(value)) {
            clean[key] = value;
        } else if (typeof value === 'boolean') {
            clean[key] = value;
        } else if (Array.isArray(value)) {
            // Provider ids and capability names only, capped, so a long
            // fallback chain cannot bloat the document.
            clean[key] = value.slice(0, MAX_ATTEMPTS).map((item) => safeString(item, 40));
        }
    }

    if (Array.isArray(entry.attempts)) {
        clean.attempts = entry.attempts
            .slice(0, MAX_ATTEMPTS)
            .map(sanitizeAttempt);
    }

    return clean;
}

/**
 * A safe description of what was asked for, built from shape rather than
 * content.
 *
 * The operational question an operator actually has is "what kind of request was
 * this" — one JPEG and six structured fields, or a 2,300-token article prompt.
 * That is answerable from counts and media types alone, so nothing derived from
 * the prompt text, the image bytes or the model's answer is used here.
 *
 * This is deliberately computed rather than passed in: a caller cannot
 * accidentally hand it a prompt.
 *
 * @param {object} task the normalized task contract
 * @returns {string} e.g. `"1 image (image/jpeg), 6 structured fields requested"`
 */
function describeTaskInput(task) {
    const parts = [];

    const images = Array.isArray(task?.images) ? task.images : [];
    if (images.length > 0) {
        // The media type comes from the data-URL prefix, never the payload.
        const types = new Set(
            images.map((image) => {
                const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(image?.dataUrl || '');
                return match ? match[1] : 'unknown';
            }),
        );
        parts.push(`${images.length} image${images.length === 1 ? '' : 's'} (${[...types].sort().join(', ')})`);
    }

    const properties = task?.outputSchema?.properties;
    if (properties && typeof properties === 'object') {
        const count = Object.keys(properties).length;
        parts.push(`${count} structured field${count === 1 ? '' : 's'} requested`);
    } else if (task?.outputSchema) {
        parts.push('structured output requested');
    }

    if (typeof task?.inputText === 'string' && task.inputText.length > 0) {
        // Length only. Never a character of the prompt itself.
        parts.push(`${task.inputText.length}-character prompt`);
    }

    return parts.join(', ') || 'no structured input';
}

/**
 * Writes one telemetry document. Never throws: a telemetry failure must not turn
 * a successful AI call into an error, nor hide a real one.
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

function toRow(doc) {
    const data = doc.data() || {};
    return {
        id: doc.id,
        ...sanitize(data),
        timestamp: data.timestamp?.toDate?.()?.toISOString() || null,
    };
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
        return snapshot.docs.map(toRow);
    } catch (error) {
        console.error(`[ai/telemetry] Could not read telemetry: ${error?.message}`);
        return [];
    }
}

module.exports = {
    COLLECTION,
    ALLOWED_FIELDS,
    ALLOWED_ATTEMPT_FIELDS,
    MAX_ATTEMPTS,
    RETENTION_DAYS,
    VENDOR_CODE_PATTERN,
    recordAiTelemetry,
    readRecentTelemetry,
    describeTaskInput,
    sanitize,
    toRow,
};
