// functions/shared/applicationEditableFields.js
//
// The allowlist of driver-application fields a Company Admin may edit (and thus
// propose as pending changes for driver approval). This is the SECURITY BOUNDARY
// for proposeApplicationChanges — anything not listed here is ignored. Scope:
// form-data fields only (no files, no computed/identity/audit fields). Arrays
// (employers/violations/accidents/previousAddresses) are replaced wholesale.
//
// The KEYS are written by hand in `applicationEditableFields.json`, deliberately:
// a security boundary should be a list somebody has to edit on purpose, not
// something derived. It is the ONE list: the dossier's Edit Application reads the
// same file and shows every other field display-only, so the screen never offers
// an edit this boundary drops. Never copy it here or into the browser.
//
// The LABELS come from the shared section table, because the driver reading "we
// would like to change your SSN" on the review portal and the record saying
// "Social Security Number" are describing the same field, and they used to
// disagree — this file said SSN / Address / CDL Number where the definition said
// Social Security Number / Current Street Address / License Number.

const { STANDARD_SECTIONS } = require('./applicationDefinition');

const EDITABLE_FIELD_KEYS = Object.freeze([...require('./applicationEditableFields.json')]);

const LABEL_BY_FIELD_ID = new Map(
    STANDARD_SECTIONS.flatMap((section) => section.fields.map((field) => [field.id, field.label])),
);

function isEditableField(key) {
    return EDITABLE_FIELD_KEYS.includes(key);
}

/**
 * The human wording for one field.
 *
 * Returns a description rather than the key when there is no recorded wording.
 * The old fallback was `|| key`, which put an internal field id in front of a
 * driver on the change-review portal — the same defect that put question UUIDs
 * in the PDF.
 */
function fieldLabel(key) {
    return LABEL_BY_FIELD_ID.get(key) || 'A field on your application';
}

/** Structural equality good enough for diffing scalars + plain arrays/objects. */
function valuesEqual(a, b) {
    if (a === b) return true;
    const an = a === undefined ? null : a;
    const bn = b === undefined ? null : b;
    if (an === null || bn === null) return an === bn;
    return JSON.stringify(an) === JSON.stringify(bn);
}

module.exports = {
    EDITABLE_FIELD_KEYS,
    isEditableField,
    fieldLabel,
    valuesEqual,
};
