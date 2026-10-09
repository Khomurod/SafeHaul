/**
 * A company's API keys: what one looks like, what it may read, and the limits
 * on it. Pure functions and constants; the callables (`keyCallables.js`) and
 * the API itself (`http.js`) make the decisions.
 *
 * ## A key is a bearer credential
 *
 * Whoever holds it reads that company's submitted applications, so it is
 * treated as the invite tokens are (`companyApplications/inviteTokens.js`):
 * 32 random bytes, shown once when it is made, and stored only as a SHA-256
 * hash compared in constant time. A lost key is replaced, never recovered.
 *
 * `shk_{keyId}_{secret}`. The key id is the document id in `company_api_keys`,
 * so a request finds its key in one read instead of a query, and it is safe to
 * show beside the key's name: it opens nothing without the secret.
 *
 * ## Scopes
 *
 * Every key reads applications; documents and the full SSN are each its own
 * grant. Writing is not offered yet, but a scope is how it will be: the API
 * names the scope each route needs, so a write route arrives with a write scope
 * and no existing key gains it.
 */

const crypto = require('crypto');

const KEY_PREFIX = 'shk';
/** Where keys are kept, by key id; server-only, no Firestore rule names it. */
const KEYS_COLLECTION = 'company_api_keys';
/** One record per request a key made; server-only, deleted after `AUDIT_DAYS`. */
const AUDIT_COLLECTION = 'api_audit';
const KEY_PATTERN = /^shk_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

/** What a key may be granted, and the sentence the company sees for each. */
const SCOPES = Object.freeze({
    'applications:read': 'Read submitted applications',
    'documents:read': 'Download the files uploaded with them',
    'ssn:read': 'Read the full Social Security Number, and the application PDF, which shows it',
});

/** Granted to every key: there is nothing else to read without it. */
const BASE_SCOPE = 'applications:read';

/** Active keys a company may hold at once: one per service, and room to rotate. */
const MAX_ACTIVE_KEYS = 5;

const MAX_NAME_LENGTH = 60;

/** Making keys, per Company Admin. Generous for real use, a wall for a loop. */
const MINT_LIMIT = Object.freeze({ limit: 10, windowSeconds: 300 });

/** Requests per key. A sync that pages through a backlog fits; a runaway loop does not. */
const REQUEST_LIMIT = Object.freeze({ limit: 60, windowSeconds: 60 });

/** Requests per address before any key is read, so guessing costs the guesser. */
const ADDRESS_LIMIT = Object.freeze({ limit: 120, windowSeconds: 60 });

/** How long a request's record is kept (`api_audit`, TTL on `expiresAt`). */
const AUDIT_DAYS = 90;

/** How long a document or PDF link works: long enough to fetch, short enough not to leak. */
const LINK_TTL_MS = 15 * 60 * 1000;

/** `lastUsedAt` is written at most this often per key, so a busy key does not write on every read. */
const LAST_USED_EVERY_MS = 60 * 1000;

function hashKey(key) {
    return crypto.createHash('sha256').update(String(key || '')).digest('hex');
}

/** Does `key` hash to `storedHash`? Constant time, as an invite token is compared. */
function keyMatches(storedHash, key) {
    const expected = Buffer.from(String(storedHash || ''), 'utf8');
    const actual = Buffer.from(hashKey(key), 'utf8');
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
}

/** A new key: the id it is stored under, and the full key, which is shown once. */
function mintKey() {
    const keyId = crypto.randomBytes(8).toString('hex');
    const secret = crypto.randomBytes(32).toString('base64url');
    return { keyId, key: `${KEY_PREFIX}_${keyId}_${secret}` };
}

/** The key id a presented key names, or null for anything not shaped like a key. */
function keyIdOf(key) {
    const match = KEY_PATTERN.exec(String(key || '').trim());
    return match ? match[1] : null;
}

/** How a key is shown beside its name: enough to tell keys apart, nothing that opens one. */
function displayPrefix(keyId) {
    return `${KEY_PREFIX}_${keyId}_…`;
}

/**
 * The scopes a new key gets: the base one, plus each requested scope this API
 * knows. An unknown one is refused rather than dropped, so a typo cannot make a
 * key that silently lacks what its maker asked for.
 *
 * @returns {{ scopes: string[] } | { unknown: string[] }}
 */
function normalizeScopes(requested) {
    const list = Array.isArray(requested) ? requested : [];
    const unknown = list.filter((scope) => !Object.prototype.hasOwnProperty.call(SCOPES, scope));
    if (unknown.length) return { unknown };
    const granted = new Set([BASE_SCOPE, ...list]);
    return { scopes: Object.keys(SCOPES).filter((scope) => granted.has(scope)) };
}

function hasScope(scopes, scope) {
    return Array.isArray(scopes) && scopes.includes(scope);
}

/** A name for a key, trimmed; null when there is none or it is too long. */
function cleanKeyName(name) {
    const text = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    return text && text.length <= MAX_NAME_LENGTH ? text : null;
}

/** Milliseconds from a Firestore `Timestamp`, a `Date` or a number; null otherwise. */
function millisOf(value) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value && typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    return typeof value === 'number' ? value : null;
}

function isoOf(value) {
    const millis = millisOf(value);
    return millis === null ? null : new Date(millis).toISOString();
}

/** A stored key as the company's settings show it. Never the hash. */
function keyView(keyId, data = {}) {
    return {
        keyId,
        name: data.name || '',
        prefix: displayPrefix(keyId),
        scopes: Array.isArray(data.scopes) ? data.scopes : [BASE_SCOPE],
        createdAt: isoOf(data.createdAt),
        createdByName: data.createdByName || null,
        lastUsedAt: isoOf(data.lastUsedAt),
        revokedAt: isoOf(data.revokedAt),
        revokedByName: data.revokedByName || null,
    };
}

module.exports = {
    ADDRESS_LIMIT,
    AUDIT_COLLECTION,
    AUDIT_DAYS,
    BASE_SCOPE,
    KEYS_COLLECTION,
    KEY_PREFIX,
    LAST_USED_EVERY_MS,
    LINK_TTL_MS,
    MAX_ACTIVE_KEYS,
    MAX_NAME_LENGTH,
    MINT_LIMIT,
    REQUEST_LIMIT,
    SCOPES,
    cleanKeyName,
    displayPrefix,
    hasScope,
    hashKey,
    isoOf,
    keyIdOf,
    keyMatches,
    keyView,
    millisOf,
    mintKey,
    normalizeScopes,
};
