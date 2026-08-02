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

  it('labels known fields and falls back to the key', () => {
    expect(fieldLabel('firstName')).toBe('First Name');
    expect(fieldLabel('totallyUnknown')).toBe('totallyUnknown');
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
