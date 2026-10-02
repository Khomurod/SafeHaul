export const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const isValidPhone = (phone) => {
    // US Phone: 10 digits or 11 digits with leading country code '1'
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) return true;
    if (cleaned.length === 11 && cleaned.startsWith('1')) return true;
    return false;
};

/**
 * D5: Single canonical phone normalizer lives in helpers.js (more robust: coerces to
 * string, trims, never drops digits). Re-exported here so existing
 * `import { normalizePhone } from '.../validation'` call sites keep working without a
 * second, drift-prone implementation.
 */
export { normalizePhone } from './helpers';

export const isValidSSN = (ssn) => {
    // Basic format check: AAA-GG-SSSS or AAAGGSSSS
    const cleaned = ssn.replace(/\D/g, '');
    return cleaned.length === 9;
};
