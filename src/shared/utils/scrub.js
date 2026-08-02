/**
 * A5 — Centralized PII scrubbing (frontend).
 *
 * Wired into Sentry's beforeSend/beforeBreadcrumb so phone/email/SSN fragments
 * never leave the browser. Two layers: key-based redaction + value pattern masks.
 *
 * Hard requirements (runs inside Sentry's pipeline): never throw (a scrub failure
 * must not drop telemetry), cycle-safe, depth-bounded.
 *
 * Mirror of functions/shared/scrub.js (kept in sync; separate packages/module
 * systems prevent a shared module).
 */

const PII_KEY = /(ssn|social[\s_-]?security|dob|date[\s_-]?of[\s_-]?birth|passwd|password|token|secret|authorization|api[\s_-]?key|credential|cookie|email|phone)/i;
const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
// Conservative US phone: requires 3-3-4 grouping + digit boundaries so it does
// not chew through arbitrary long digit runs (IDs, timestamps). The leading
// boundary is a capture group (^|\D) rather than a lookbehind, because regex
// lookbehind throws a SyntaxError on iOS Safari < 16.4 and would crash the bundle.
const PHONE = /(^|\D)((?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?!\d)/g;

const MAX_DEPTH = 8;

export function scrubString(value) {
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
    if (value instanceof Date) return value;
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
export function scrub(value) {
    try {
        return scrubValue(value, new WeakSet(), 0);
    } catch {
        return value;
    }
}
