// functions/shared/normalizePhone.js
// M6 FIX: Shared utility to normalize phone numbers to E.164 US format.
// Ensures consistent storage so blacklist lookups work regardless of input format.

/**
 * Normalizes a US phone number to E.164 format (+1XXXXXXXXXX).
 * Strips all non-digit characters, then prepends +1 if not present.
 * @param {string|null} phone - Raw phone string
 * @returns {string|null} - E.164 normalized phone or null if invalid
 */
function normalizePhone(phone) {
    if (!phone || typeof phone !== 'string') return null;

    // Strip everything except digits and leading +
    const digitsOnly = phone.replace(/[^\d]/g, '');

    if (!digitsOnly) return null;

    // Handle 10-digit (US without country code): prepend +1
    if (digitsOnly.length === 10) {
        return `+1${digitsOnly}`;
    }

    // Handle 11-digit starting with 1 (US with country code): prepend +
    if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
        return `+${digitsOnly}`;
    }

    // Handle already E.164 (12+ digit with + prefix): return as-is with +
    if (digitsOnly.length >= 11) {
        return `+${digitsOnly}`;
    }

    // Too short to be a valid number — return null
    return null;
}

module.exports = { normalizePhone };
