/**
 * RFC 5321/5322 compatible email validation.
 * More robust than a simple /^[^\s@]+@[^\s@]+\.[^\s@]+$/ regex.
 */
function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    // Max 254 chars per RFC 5321
    if (email.length > 254) return false;
    // Split into local@domain
    const atIndex = email.lastIndexOf('@');
    if (atIndex < 1) return false; // no @ or empty local part
    const local = email.substring(0, atIndex);
    const domain = email.substring(atIndex + 1);
    // local part max 64 chars
    if (local.length > 64 || domain.length < 3) return false;
    // Domain must contain a dot and no consecutive dots
    if (!domain.includes('.') || domain.includes('..')) return false;
    // Full pattern check (RFC 5322 simplified)
    return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(email);
}

module.exports = { isValidEmail };
