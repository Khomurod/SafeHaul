/**
 * A5 — Centralized PII scrubbing (backend).
 *
 * Scrubbing belongs at the sink (Sentry beforeSend, the logger wrapper), not at
 * every call site — per-call discipline always rots. Two layers of defense:
 *   1. Key-based redaction: any object key whose name looks like a secret/PII
 *      field has its value replaced with [redacted].
 *   2. Value pattern-matching: SSN / email / phone substrings inside any string
 *      are masked.
 *
 * Hard requirements (this runs inside Sentry's error pipeline):
 *   - Never throw — a scrub failure must NOT drop telemetry (returns input).
 *   - Cycle-safe and depth-bounded — Sentry events can be deep / self-referential.
 *
 * Mirror of src/shared/utils/scrub.js (kept in sync; the two packages cannot
 * share a module — separate npm packages + module systems).
 */

const PII_KEY = /(ssn|social[\s_-]?security|dob|date[\s_-]?of[\s_-]?birth|passwd|password|token|secret|authorization|api[\s_-]?key|credential|cookie|email|phone)/i;
const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
// Conservative US phone: requires the 3-3-4 grouping and digit boundaries so it
// does not chew through arbitrary long digit runs (IDs, timestamps). Leading
// boundary is a capture group (^|\D) rather than a lookbehind, kept identical to
// the frontend mirror (which must avoid lookbehind for older iOS Safari).
const PHONE = /(^|\D)((?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?!\d)/g;

const MAX_DEPTH = 8;

function scrubString(value) {
    if (typeof value !== 'string') return value;
    return value
        .replace(SSN, '[ssn]')
        .replace(EMAIL, '[email]')
        .replace(PHONE, (_match, pre) => `${pre}[phone]`);
}

function scrubValue(value, seen, depth) {
    if (depth > MAX_DEPTH) return value;
    if (typeof value === 'string') return scrubString(value);
    if (!value || typeof value !== 'object') return value;
    // Don't recurse into non-plain objects (Buffer, Date, etc.).
    if (Buffer.isBuffer(value) || value instanceof Date) return value;
    if (seen.has(value)) return value; // cycle guard
    seen.add(value);

    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            value[i] = scrubValue(value[i], seen, depth + 1);
        }
        return value;
    }

    for (const key of Object.keys(value)) {
        value[key] = PII_KEY.test(key) ? '[redacted]' : scrubValue(value[key], seen, depth + 1);
    }
    return value;
}

/**
 * Deep-scrub a value (string, object, array) in place and return it.
 * Always returns something — never throws.
 */
function scrub(value) {
    try {
        return scrubValue(value, new WeakSet(), 0);
    } catch {
        return value;
    }
}

module.exports = { scrub, scrubString };
