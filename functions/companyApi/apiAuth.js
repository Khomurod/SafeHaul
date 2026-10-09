/**
 * Who is calling the company API, and whether they may.
 *
 * A request is answered only for a key that exists, matches its stored hash,
 * has not been turned off, and belongs to a company that still exists. The
 * address limit comes before any key is read, so guessing keys costs the
 * guesser; the key's own limit comes after.
 */

const { db } = require('../firebaseAdmin');
const { checkRateLimit } = require('../shared/rateLimiter');
const {
    ADDRESS_LIMIT,
    BASE_SCOPE,
    KEYS_COLLECTION,
    LAST_USED_EVERY_MS,
    REQUEST_LIMIT,
    keyIdOf,
    keyMatches,
    millisOf,
} = require('./apiKeys');

/** A refusal with its HTTP status and the code a caller's program reads. */
class ApiError extends Error {
    constructor(status, code, message, headers = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.headers = headers;
    }
}

const RATE_LIMITED = (window) => new ApiError(
    429, 'rate_limited', `Too many requests. Wait ${window} seconds and try again.`, { 'Retry-After': String(window) },
);

/** The caller's address, as a rate-limit key may hold it. */
function clientAddress(req) {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const address = String(req.ip || forwarded || 'unknown');
    return address.replace(/[^0-9A-Za-z:.]/g, '_').slice(0, 64) || 'unknown';
}

/** The key from `Authorization: Bearer <key>`, or null. */
function presentedKey(req) {
    const header = typeof req.get === 'function' ? req.get('authorization') : req.headers?.authorization;
    const match = /^Bearer\s+(\S+)$/i.exec(String(header || '').trim());
    return match ? match[1] : null;
}

/** Records that the key was used, at most once a minute; a failed write costs the caller nothing. */
async function noteUse(keyId, data) {
    const last = millisOf(data.lastUsedAt);
    if (last !== null && Date.now() - last < LAST_USED_EVERY_MS) return;
    try {
        await db.collection(KEYS_COLLECTION).doc(keyId).update({ lastUsedAt: new Date() });
    } catch (error) {
        console.warn(`[companyApi] lastUsedAt not written for key ${keyId}: ${error?.message || 'unknown'}`);
    }
}

/**
 * @returns {Promise<{keyId: string, companyId: string, companyName: string|null,
 *   name: string, scopes: string[], address: string}>}
 * @throws {ApiError}
 */
async function authenticate(req) {
    const address = clientAddress(req);
    if (!(await checkRateLimit(`api_addr_${address}`, ADDRESS_LIMIT.limit, ADDRESS_LIMIT.windowSeconds, 'open'))) {
        throw RATE_LIMITED(ADDRESS_LIMIT.windowSeconds);
    }

    const key = presentedKey(req);
    if (!key) throw new ApiError(401, 'missing_key', 'Send the API key as "Authorization: Bearer <key>".');
    const keyId = keyIdOf(key);
    if (!keyId) throw new ApiError(401, 'invalid_key', 'This API key is not valid.');

    const snap = await db.collection(KEYS_COLLECTION).doc(keyId).get();
    const data = snap.exists ? snap.data() : null;
    if (!data || !keyMatches(data.hash, key)) throw new ApiError(401, 'invalid_key', 'This API key is not valid.');
    if (data.revokedAt) throw new ApiError(401, 'key_revoked', 'This API key has been turned off.');

    const company = await db.collection('companies').doc(String(data.companyId || '')).get();
    if (!company.exists) throw new ApiError(401, 'invalid_key', 'This API key is not valid.');

    if (!(await checkRateLimit(`api_key_${keyId}`, REQUEST_LIMIT.limit, REQUEST_LIMIT.windowSeconds, 'closed'))) {
        throw RATE_LIMITED(REQUEST_LIMIT.windowSeconds);
    }
    await noteUse(keyId, data);

    return {
        keyId,
        companyId: data.companyId,
        companyName: company.data()?.companyName || null,
        name: data.name || '',
        scopes: Array.isArray(data.scopes) ? data.scopes : [BASE_SCOPE],
        address,
    };
}

module.exports = { ApiError, authenticate, clientAddress, presentedKey };
