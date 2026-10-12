const { normalizePhone } = require('../shared/normalizePhone');

/**
 * Normalize phone numbers for keychain document IDs and inventory matching.
 *
 * A number written with "+" carries its country code and is kept as written:
 * that is the form of every stored line key and of RingCentral's inventory. One
 * written without it is read by the shared `normalizePhone`, so "(555) 123-4567"
 * is the line RingCentral reports as +15551234567, not the different number
 * +5551234567. What that cannot read keeps the old "+digits" form.
 * @param {string} phoneNumber
 * @returns {string} E.164-like string (e.g. +15551234567)
 */
function normalizePhoneForKeychain(phoneNumber) {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
        throw new Error('Invalid phone number');
    }
    const rawSanitized = phoneNumber.replace(/[^0-9+]/g, '');
    if (rawSanitized.startsWith('+')) return rawSanitized;
    return normalizePhone(phoneNumber) || `+${rawSanitized}`;
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
