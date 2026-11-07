/**
 * Application ID Generator
 * 
 * Generates chronological application IDs while preserving identity linkage.
 * 
 * @module applicationId
 */

/**
 * Generate a SHA-256 hash of the input string
 * Uses Web Crypto API (available in all modern browsers)
 * 
 * @param {string} input - String to hash
 * @returns {Promise<string>} Hex-encoded hash
 */
async function sha256(input) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalize a phone number by removing all non-digit characters
 * @param {string} phone - Raw phone number
 * @returns {string} Normalized phone (digits only)
 */
function normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/\D/g, '');
}

/**
 * Normalize an email address (lowercase, trim whitespace)
 * @param {string} email - Raw email
 * @returns {string} Normalized email
 */
function normalizeEmail(email) {
    if (!email) return '';
    return email.toLowerCase().trim();
}

/**
 * Generate a fully deterministic application ID based on company, email, and phone.
 *
 * Identical inputs always produce the same ID, so re-submissions and offline
 * queue retries naturally collide and become idempotent upserts. The backend
 * uses `set(..., { merge: true })` so the second write updates the first
 * document instead of creating a duplicate.
 *
 * @param {string} companyId - Target company ID
 * @param {string} email - Applicant email (optional but recommended)
 * @param {string} phone - Applicant phone (optional but recommended)
 * @returns {Promise<string>} 20-character deterministic application ID
 *
 * @example
 * const appId = await generateApplicationId('company-123', 'john@example.com', '555-123-4567');
 * // Returns: '3a7f2b9c8d1e4f5a6b7c'
 */
export async function generateApplicationId(companyId, email, phone) {
    if (!companyId) {
        throw new Error('companyId is required for application ID generation');
    }

    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedEmail && !normalizedPhone) {
        console.warn('[ApplicationId] No email or phone provided, generating anonymous application ID');
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `anon_${timestamp}_${random}`;
    }

    // Canonical input: companyId + normalized email + normalized phone
    const canonicalInput = `${companyId}:${normalizedEmail}:${normalizedPhone}`;
    const hash = await sha256(canonicalInput);
    return hash.substring(0, 20);
}

/**
 * Generate a confirmation number for user-facing display
 * Format: SAF-YYYY-XXXXX (e.g., SAF-2026-A7B2C)
 * 
 * @returns {string} User-friendly confirmation number
 */
export function generateConfirmationNumber() {
    const year = new Date().getFullYear();
    const random = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `SAF-${year}-${random}`;
}
