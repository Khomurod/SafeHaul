const fs = require('node:fs');
const path = require('node:path');
const {
  EDITABLE_FIELD_KEYS,
  isEditableField,
  fieldLabel,
  valuesEqual,
} = require('../../shared/applicationEditableFields');

describe('applicationEditableFields', () => {
  it('allows known form-data fields and rejects everything else (files/identity/audit)', () => {
    expect(isEditableField('firstName')).toBe(true);
    expect(isEditableField('employers')).toBe(true);
    // Not editable: files, identity, computed, audit
    for (const k of ['cdl-front', 'companyId', 'applicationId', 'status', 'signature', 'updatedAt', 'hasPendingCompanyChanges', '__proto__']) {
      expect(isEditableField(k)).toBe(false);
    }
  });

  it('exposes a frozen, non-empty key list', () => {
    expect(EDITABLE_FIELD_KEYS.length).toBeGreaterThan(10);
    expect(Object.isFrozen(EDITABLE_FIELD_KEYS)).toBe(true);
  });

  it('is the one list in applicationEditableFields.json, which the dossier reads too', () => {
    // The browser shows every other field display-only while editing, so a key
    // added here and not there (or the reverse) would offer an edit the server
    // drops, or hide one it takes. One file, read by both, cannot disagree.
    const shared = require('../../shared/applicationEditableFields.json');
    expect(EDITABLE_FIELD_KEYS).toEqual(shared);
    const source = fs.readFileSync(path.join(__dirname, '../../shared/applicationEditableFields.js'), 'utf8');
    expect(source).not.toMatch(/'middleName'/);
  });

  it('takes its wording from the shared section table, not a second copy', () => {
    // These three used to disagree with the definition — this file said SSN /
    // Address / CDL Number where the record said Social Security Number /
    // Current Street Address / License Number, so the change-review portal and
    // the preserved record named the same field differently.
    expect(fieldLabel('firstName')).toBe('First Name');
    expect(fieldLabel('ssn')).toBe('Social Security Number');
    expect(fieldLabel('street')).toBe('Current Street Address');
    expect(fieldLabel('cdlNumber')).toBe('License Number');
  });

  it('describes an unrecognised field instead of printing its key to the driver', () => {
    // The old fallback was `|| key`, which put an internal field id in front of
    // an applicant on the change-review portal.
    expect(fieldLabel('totallyUnknown')).toBe('A field on your application');
    expect(fieldLabel('totallyUnknown')).not.toMatch(/totallyUnknown/);
  });

  it('has recorded wording for every editable key', () => {
    // A key with no entry in the section table would fall through to the
    // generic description, which reads as a bug on the change-review portal.
    for (const key of EDITABLE_FIELD_KEYS) {
      expect(fieldLabel(key)).not.toBe('A field on your application');
    }
  });

  it('valuesEqual treats undefined and null as equal, and compares arrays/objects structurally', () => {
    expect(valuesEqual(undefined, null)).toBe(true);
    expect(valuesEqual('a', 'a')).toBe(true);
    expect(valuesEqual('a', 'b')).toBe(false);
    expect(valuesEqual([1, 2], [1, 2])).toBe(true);
    expect(valuesEqual([1, 2], [2, 1])).toBe(false);
    expect(valuesEqual({ x: 1 }, { x: 1 })).toBe(true);
    expect(valuesEqual({ x: 1 }, { x: 2 })).toBe(false);
  });
});
