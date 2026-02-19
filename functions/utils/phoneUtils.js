/**
 * Server-side phone normalization utility.
 * Mirrors client-side normalizePhone from src/shared/utils/helpers.js
 */

/**
 * Strips a phone number to raw digits for database searching/comparison.
 * Returns raw digits even if length != 10 to prevent data loss.
 * @param {string} phone - The phone number to normalize
 * @returns {string} Normalized phone number (digits only)
 */
function normalizePhone(phone) {
    if (!phone) return "";

    // 1. Convert to string and remove non-digits
    let cleaned = String(phone).trim().replace(/\D/g, '');

    // 2. Handle US Country Code (Strip leading 1 if length is 11)
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
        cleaned = cleaned.substring(1);
    }

    // 3. Return whatever digits we have.
    return cleaned;
}

module.exports = { normalizePhone };
