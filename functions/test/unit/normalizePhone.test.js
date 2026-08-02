const { normalizePhone } = require('../../shared/normalizePhone');

describe('normalizePhone (shared)', () => {
  it('normalizes 10-digit US to +1 E.164', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('+15551234567');
  });

  it('normalizes 11-digit US with leading 1', () => {
    expect(normalizePhone('1-555-123-4567')).toBe('+15551234567');
  });

  it('returns null for empty or invalid input', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('123')).toBeNull();
  });

  it('normalizes common US input formats to the same E.164 value', () => {
    expect(normalizePhone('(470) 480-4679')).toBe('+14704804679');
    expect(normalizePhone('470-480-4679')).toBe('+14704804679');
    expect(normalizePhone('+1 470 480 4679')).toBe('+14704804679');
    expect(normalizePhone('470.480.4679')).toBe('+14704804679');
    expect(normalizePhone('4704804679')).toBe('+14704804679');
  });

  it('returns null for short/invalid numbers and non-string input', () => {
    expect(normalizePhone('480-4679')).toBeNull(); // 7 digits — too short
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone(4704804679)).toBeNull(); // numbers are rejected, only strings accepted
  });
});
