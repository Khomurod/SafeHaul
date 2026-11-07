/**
 * Canonical search-field normalization for application/lead records.
 *
 * This is the single behavioral source of truth for how search fields are
 * normalized before being PERSISTED on documents and before being QUERIED.
 * A byte-for-byte ESM mirror lives at src/shared/utils/searchNormalization.js
 * (the frontend cannot import CommonJS app source, and Cloud Functions cannot
 * require() files outside functions/). Both copies are locked together by the
 * shared test-vector suite in functions/shared/searchNormalization.vectors.json,
 * exercised by functions/test/unit/searchNormalization.test.js (this file) and
 * src/shared/utils/searchNormalization.test.js (the mirror). Change one copy
 * and the vector tests fail until the other matches; the body between the
 * markers must stay byte-identical, which the mirror's test checks.
 */

const { nationalDigits } = require('./applicantIdentity');

// --- body ---------------------------------------------------------------------
// Identical to src/shared/utils/searchNormalization.js. Edit both, or the parity test fails.

/** Lowercase, trim, and collapse internal whitespace. */
function normalizeSearchText(value) {
    if (value === null || value === undefined) return '';
    return String(value).toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Name fields: same as generic text normalization. */
function normalizeSearchName(value) {
    return normalizeSearchText(value);
}

/** Email: lowercase + trim (no whitespace collapsing inside an email). */
function normalizeSearchEmail(value) {
    if (value === null || value === undefined) return '';
    return String(value).toLowerCase().trim();
}

/**
 * Phone: digits only; a leading US country code "1" on an 11-digit number is
 * stripped. It is `nationalDigits`, the one reading of a phone's digits (the
 * site's `normalizePhone` in src/shared/utils/helpers.js is too), so records
 * written here stay queryable by the existing phoneNormalized reads.
 */
function normalizeSearchPhone(value) {
    if (value === null || value === undefined) return '';
    return nationalDigits(String(value));
}

/** Confirmation numbers are stored uppercase (SAF-2026-XXXXX); normalize to uppercase, no spaces. */
function normalizeSearchConfirmation(value) {
    if (value === null || value === undefined) return '';
    return String(value).toUpperCase().replace(/\s+/g, '');
}

/** Application IDs are lowercase base36/hex; normalize to lowercase, no spaces. */
function normalizeSearchApplicationId(value) {
    if (value === null || value === undefined) return '';
    return String(value).toLowerCase().replace(/\s+/g, '');
}

/**
 * Build the persisted normalized search fields for an application document.
 * Every application write path (guest callable, recruiter edit, backfill) must
 * funnel through this so queries and writes can never drift.
 *
 * @param {{firstName?: unknown, lastName?: unknown, email?: unknown, phone?: unknown,
 *   confirmationNumber?: unknown, applicationId?: unknown}} [identity]
 */
function buildApplicationSearchFields({
    firstName,
    lastName,
    email,
    phone,
    confirmationNumber,
    applicationId,
} = {}) {
    const firstNameNormalized = normalizeSearchName(firstName);
    const lastNameNormalized = normalizeSearchName(lastName);
    const fullNameNormalized = normalizeSearchText(
        `${firstNameNormalized} ${lastNameNormalized}`
    );
    return {
        firstNameNormalized,
        lastNameNormalized,
        fullNameNormalized,
        emailNormalized: normalizeSearchEmail(email),
        phoneNormalized: normalizeSearchPhone(phone),
        confirmationNumberNormalized: normalizeSearchConfirmation(confirmationNumber),
        applicationIdNormalized: normalizeSearchApplicationId(applicationId),
    };
}

// --- exports -------------------------------------------------------------------

module.exports = {
    normalizeSearchText,
    normalizeSearchName,
    normalizeSearchEmail,
    normalizeSearchPhone,
    normalizeSearchConfirmation,
    normalizeSearchApplicationId,
    buildApplicationSearchFields,
};
