/**
 * Server-side phone normalization utility.
 * P2-1 FIX: Delegates to shared/normalizePhone.js for consistent E.164 formatting.
 * This ensures blacklist lookups, bulk messaging, and all phone comparisons
 * use the same canonical format (+1XXXXXXXXXX).
 */
const { normalizePhone: normalizeToE164 } = require('../shared/normalizePhone');

/**
 * Normalizes a phone number to E.164 format for consistent storage/comparison.
 * @param {string} phone - The phone number to normalize
 * @returns {string} Normalized phone in E.164 (+1XXXXXXXXXX) or empty string if invalid
 */
function normalizePhone(phone) {
    return normalizeToE164(phone) || "";
}

module.exports = { normalizePhone };
