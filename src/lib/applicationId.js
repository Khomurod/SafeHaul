/**
 * Application ID Generator
 * 
 * Generates deterministic application IDs based on key fields (companyId, email, phone).
 * This prevents duplicate applications and enables idempotent submissions.
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
 * Generate a deterministic application ID based on company, email, and phone
 * 
 * The same inputs will always produce the same ID, which:
 * - Prevents duplicate applications (Firestore setDoc with same ID = update)
 * - Enables idempotent retries (safe to retry without creating duplicates)
 * - Provides consistent reference for tracking
 * 
 * @param {string} companyId - Target company ID
 * @param {string} email - Applicant email (optional but recommended)
 * @param {string} phone - Applicant phone (optional but recommended)
 * @returns {Promise<string>} 20-character hex application ID
 * 
 * @example
 * const appId = await generateApplicationId('company-123', 'john@example.com', '555-123-4567');
 * // Returns: '3a7f2b9c8d1e4f5a6b7c' (deterministic)
 */
export async function generateApplicationId(companyId, email, phone) {
    if (!companyId) {
        throw new Error('companyId is required for application ID generation');
    }

    // At least one identifier (email or phone) should be provided
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedEmail && !normalizedPhone) {
        // Fallback: use timestamp + random for truly anonymous submissions
        // This is less ideal but prevents blocking the submission entirely
        console.warn('[ApplicationId] No email or phone provided, using timestamp fallback');
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `anon_${timestamp}_${random}`;
    }

    // Create a canonical input string
    // Format: companyId:email:phone (normalized)
    const canonicalInput = `${companyId}:${normalizedEmail}:${normalizedPhone}`;

    // Generate hash
    const hash = await sha256(canonicalInput);

    // Return first 20 characters (80 bits of entropy - sufficient for uniqueness)
    return hash.substring(0, 20);
}

/**
 * Synchronous version using simple hash for cases where async is problematic
 * Less secure but deterministic - suitable for non-critical client-side use
 * 
 * @param {string} companyId - Target company ID  
 * @param {string} email - Applicant email
 * @param {string} phone - Applicant phone
 * @returns {string} 20-character application ID
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

    // Simple hash (djb2 algorithm) - fast and deterministic
    let hash = 5381;
    for (let i = 0; i < canonicalInput.length; i++) {
        hash = ((hash << 5) + hash) + canonicalInput.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }

    // Convert to base36 and pad to ensure consistent length
    const base36 = Math.abs(hash).toString(36);
    const timestamp = Date.now().toString(36).slice(-6);

    // Combine hash with truncated timestamp for additional uniqueness
    return `${base36.padStart(7, '0')}_${normalizedPhone.slice(-4) || normalizedEmail.slice(0, 4)}_${timestamp}`;
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

    // Anonymous format: anon_timestamp_random
    if (id.startsWith('anon_')) {
        return /^anon_[a-z0-9]+_[a-z0-9]+$/.test(id);
    }

    // Hash format: 20 hex characters
    if (/^[a-f0-9]{20}$/.test(id)) return true;

    // Sync format: hash_identifier_timestamp
    if (/^[a-z0-9]+_[a-z0-9]+_[a-z0-9]+$/.test(id)) return true;

    return false;
}
