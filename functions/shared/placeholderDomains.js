/**
 * Centralized placeholder email domain configuration (Cloud Functions / CommonJS).
 *
 * All code that generates or checks placeholder emails should use these constants
 * so detection is never out of sync.
 */

/** The canonical domain used when generating new placeholder emails. */
const PLACEHOLDER_DOMAIN = 'placeholder.safehaulapp.com';

/** All domains that should be treated as "placeholder" (includes legacy values). */
const PLACEHOLDER_DOMAINS = [
    'placeholder.safehaulapp.com',
    'placeholder.com',
    'system.local',
];

/**
 * Returns true if the given email is a known placeholder (or empty / missing).
 * @param {string|null|undefined} email
 * @returns {boolean}
 */
function isPlaceholderEmail(email) {
    if (!email || typeof email !== 'string') return true;
    const lower = email.toLowerCase().trim();
    if (!lower) return true;
    return PLACEHOLDER_DOMAINS.some(d => lower.endsWith(`@${d}`));
}

module.exports = { PLACEHOLDER_DOMAIN, PLACEHOLDER_DOMAINS, isPlaceholderEmail };
