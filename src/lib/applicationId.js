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
 * Synchronous deterministic version of {@link generateApplicationId}. Uses
 * djb2-style double-hashing so we don't depend on the Web Crypto API. Same
 * input always yields the same 20-char ID (no timestamps, no random suffix).
 *
 * @param {string} companyId - Target company ID
 * @param {string} email - Applicant email
 * @param {string} phone - Applicant phone
 * @returns {string} 20-character deterministic application ID
 */
export function generateApplicationIdSync(companyId, email, phone) {
    if (!companyId) {
        throw new Error('companyId is required for application ID generation');
    }

    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedEmail && !normalizedPhone) {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `anon_${timestamp}_${random}`;
    }

    const canonicalInput = `${companyId}:${normalizedEmail}:${normalizedPhone}`;

    // Two independent hash seeds give 20 deterministic base-36 chars.
    let hash1 = 5381;
    for (let i = 0; i < canonicalInput.length; i++) {
        hash1 = ((hash1 << 5) + hash1) + canonicalInput.charCodeAt(i);
        hash1 = hash1 & hash1;
    }
    let hash2 = 7919;
    for (let i = 0; i < canonicalInput.length; i++) {
        hash2 = ((hash2 << 5) + hash2) ^ canonicalInput.charCodeAt(i);
        hash2 = hash2 & hash2;
    }

    const part1 = Math.abs(hash1).toString(36).padStart(10, '0');
    const part2 = Math.abs(hash2).toString(36).padStart(10, '0');
    return `${part1}${part2}`.substring(0, 20).padEnd(20, '0');
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

/**
 * Extract timestamp from confirmation number (for debugging)
 * @param {string} confirmationNumber - The confirmation number
 * @returns {number|null} Year from confirmation, or null if invalid
 */
export function parseConfirmationNumber(confirmationNumber) {
    if (!confirmationNumber) return null;
    const match = confirmationNumber.match(/^SAF-(\d{4})-[A-Z0-9]{5}$/);
    return match ? parseInt(match[1], 10) : null;
}

/**
 * Validate that an application ID looks correct
 * @param {string} id - Application ID to validate
 * @returns {boolean} True if valid format
 */
export function isValidApplicationId(id) {
    if (!id || typeof id !== 'string') return false;

    // Anonymous format: anon_timestamp_random (still used when no email/phone)
    if (id.startsWith('anon_')) {
        return /^anon_[a-z0-9]+_[a-z0-9]+$/.test(id);
    }

    // Current deterministic format: exactly 20 lowercase hex/base36 chars
    if (/^[a-z0-9]{20}$/.test(id)) return true;

    // Legacy: 20-char prefix + timestamp + random suffix (pre-bug-fix records)
    if (/^[a-z0-9]{20}_[a-z0-9]+_[a-z0-9]+$/.test(id)) return true;

    return false;
}
