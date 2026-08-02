const { normalizePhone } = require('../shared/normalizePhone');

/**
 * Normalize phone numbers for keychain document IDs and inventory matching.
 * @param {string} phoneNumber
 * @returns {string} E.164-like string (e.g. +15551234567)
 */
function normalizePhoneForKeychain(phoneNumber) {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
        throw new Error('Invalid phone number');
    }
    const rawSanitized = phoneNumber.replace(/[^0-9+]/g, '');
    return rawSanitized.startsWith('+') ? rawSanitized : `+${rawSanitized}`;
}

/**
 * True if `phoneNumber` plausibly contains a real dialable number (not just "+"
 * or punctuation). Guards against malformed inventory entries that sanitize to
 * the bare "+" and then fail keychain lookups ("No authentication key found for +").
 * @param {*} phoneNumber
 * @returns {boolean}
 */
function isLikelyValidPhone(phoneNumber) {
    if (!phoneNumber || typeof phoneNumber !== 'string') return false;
    const digits = phoneNumber.replace(/[^0-9]/g, '');
    return digits.length >= 7;
}

module.exports = { normalizePhoneForKeychain, normalizePhone, isLikelyValidPhone };
