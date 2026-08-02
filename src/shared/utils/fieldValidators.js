import { isValidEmail, isValidPhone, isValidSSN } from './validation';

/**
 * Field validator factories (C5).
 *
 * A validator is `(value, allValues) => string | null` — return an error message
 * or null when valid. They are the single source of per-field rules and reuse the
 * canonical predicates in `validation.js`, so on-blur validation and submit-time
 * validation can never drift apart.
 */

/** Required (non-empty after trim). */
export function required(label) {
    return (value) => {
        if (value === undefined || value === null || String(value).trim() === '') {
            return `${label} is required.`;
        }
        return null;
    };
}

/** Email: required-or-optional plus format via isValidEmail. */
export function email(label = 'Email', { isRequired = true } = {}) {
    return (value) => {
        const v = (value ?? '').toString().trim();
        if (!v) return isRequired ? `${label} is required.` : null;
        if (!isValidEmail(v)) return 'Please enter a valid email address.';
        return null;
    };
}

/** Phone: required-or-optional plus format via isValidPhone. */
export function phone(label = 'Phone', { isRequired = true } = {}) {
    return (value) => {
        const v = (value ?? '').toString().trim();
        if (!v) return isRequired ? `${label} is required.` : null;
        if (!isValidPhone(v)) return 'Enter a valid phone number (at least 10 digits).';
        return null;
    };
}

/** SSN: required-or-optional plus format via isValidSSN. */
export function ssn(label = 'SSN', { isRequired = true } = {}) {
    return (value) => {
        const v = (value ?? '').toString().trim();
        if (!v) return isRequired ? `${label} is required.` : null;
        if (!isValidSSN(v)) return 'SSN must be 9 digits (XXX-XX-XXXX).';
        return null;
    };
}

/**
 * Derive a validator from a schema-ish field descriptor `{ label, type, required }`,
 * so the schema's own type/required metadata drives validation (SchemaRenderer path).
 */
export function fromFieldDefinition(def, isRequired = def?.required) {
    const label = def?.label || def?.key || 'This field';
    switch (def?.type) {
        case 'email':
            return email(label, { isRequired });
        case 'tel':
        case 'phone':
            return phone(label, { isRequired });
        default:
            return isRequired ? required(label) : () => null;
    }
}
