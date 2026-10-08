export const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/**
 * The rule a browser applies to an email field, plus a dot in the domain, which
 * is also what `sendVerificationRequest` accepts (`functions/employmentVerification/requests.js`).
 *
 * For an address that will be written to: an employer's, which a verification
 * request is later sent to. `isValidEmail` passes "a@aol..com" and "a@aol,com";
 * FMCSA's census holds both, and "NONE", in its email column.
 */
const WELL_FORMED_EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export const isWellFormedEmail = (email) => (
    typeof email === 'string' && email.length <= 254 && email.indexOf('@') <= 64 && WELL_FORMED_EMAIL.test(email)
);

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
