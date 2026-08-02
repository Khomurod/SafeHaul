// functions/shared/applicationEditableFields.js
//
// The allowlist of driver-application fields a Company Admin may edit (and thus
// propose as pending changes for driver approval). This is the SECURITY BOUNDARY
// for proposeApplicationChanges — anything not listed here is ignored. Scope:
// form-data fields only (no files, no computed/identity/audit fields). Arrays
// (employers/violations/accidents/previousAddresses) are replaced wholesale.

const EDITABLE_FIELD_LABELS = Object.freeze({
    firstName: 'First Name',
    middleName: 'Middle Name',
    lastName: 'Last Name',
    suffix: 'Suffix',
    email: 'Email',
    phone: 'Phone',
    dob: 'Date of Birth',
    ssn: 'SSN',
    street: 'Address',
    city: 'City',
    state: 'State',
    zip: 'ZIP Code',
    cdlNumber: 'CDL Number',
    cdlState: 'CDL State',
    cdlClass: 'CDL Class',
    cdlExpiration: 'CDL Expiration',
    'experience-years': 'Years of Experience',
    endorsements: 'Endorsements',
    employers: 'Employment History',
    violations: 'Violations',
    accidents: 'Accidents',
    previousAddresses: 'Previous Addresses',
});

const EDITABLE_FIELD_KEYS = Object.freeze(Object.keys(EDITABLE_FIELD_LABELS));

function isEditableField(key) {
    return Object.prototype.hasOwnProperty.call(EDITABLE_FIELD_LABELS, key);
}

function fieldLabel(key) {
    return EDITABLE_FIELD_LABELS[key] || key;
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
    EDITABLE_FIELD_LABELS,
    EDITABLE_FIELD_KEYS,
    isEditableField,
    fieldLabel,
    valuesEqual,
};
