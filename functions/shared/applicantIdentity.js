/**
 * How an applicant's identity facts are compared when an unfinished
 * application is resumed: the name, the date of birth, the SSN and the phone,
 * each reduced to what makes two spellings one person.
 *
 * The server keys a saved application on these (`buildIdentityKey` and
 * `contactMatches` in `applicationDraft.js`), and the wizard's "Finish later"
 * says whether another device can find it
 * (`src/features/driver-app/components/application/resumeIdentity.js`). If the
 * two copies read a fact differently, "Finish later" promises a match the
 * server never finds. `nationalDigits` is also the one reading of a phone's
 * digits (`normalizeSearchPhone`, the site's `normalizePhone`); the E.164 form
 * is `toE164Us`.
 *
 * MIRRORED, DELIBERATELY. `src/shared/utils/applicantIdentity.js` is the
 * browser copy: the body between the markers is byte-identical, and
 * `src/shared/utils/applicantIdentity.test.js` fails if it drifts. Both copies
 * run `applicantIdentity.vectors.json`. Pure and dependency-free on purpose.
 */

// --- body ---------------------------------------------------------------------
// Identical to src/shared/utils/applicantIdentity.js. Edit both, or the parity test fails.

/** Digits only, so `123-45-6789` and `123456789` are one person. */
function normalizeSsn(value) {
    return String(value || '').replace(/\D/g, '');
}

/** Case, accents and punctuation removed, so `O'Brien` and `obrien` match. */
function normalizeName(value) {
    return String(value || '')
        // NFKD splits an accented letter into a plain letter plus a combining
        // mark, and the a-z filter below then drops the mark — so `Muñoz` and
        // `Munoz` are one name without needing a diacritics range of its own.
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z]/g, '');
}

/** `YYYY-MM-DD`, or empty when the value is not a date at all. */
function normalizeDob(value) {
    const text = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/**
 * A phone number's digits without the country code: "+1 (555) 123-4567" and
 * "555-123-4567" are one number, and a driver who typed it one way on page one
 * and the other on "Is this you?" was told it did not match.
 */
function nationalDigits(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

// --- exports -------------------------------------------------------------------

module.exports = { normalizeSsn, normalizeName, normalizeDob, nationalDigits };
