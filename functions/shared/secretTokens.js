const crypto = require('crypto');

/**
 * A bearer secret — a resume token, an invite token, a company API key — is
 * handed out once and only its SHA-256 is stored, so a leaked database row
 * cannot be replayed. It is compared in constant time, because a comparison
 * that leaks its prefix through timing is one an attacker can walk.
 */

/** The SHA-256 (hex) a secret is stored as. */
function hashSecret(secret) {
    return crypto.createHash('sha256').update(String(secret || '')).digest('hex');
}

/** Whether `secret` hashes to `storedHash`, compared in constant time. */
function secretMatches(storedHash, secret) {
    const expected = Buffer.from(String(storedHash || ''), 'utf8');
    const actual = Buffer.from(hashSecret(secret), 'utf8');
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
}

module.exports = { hashSecret, secretMatches };
