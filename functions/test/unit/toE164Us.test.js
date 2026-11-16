const { toE164Us } = require('../../shared/toE164Us');

describe('toE164Us (shared)', () => {
  it('normalizes 10-digit US to +1 E.164', () => {
    expect(toE164Us('(555) 123-4567')).toBe('+15551234567');
  });

  it('normalizes 11-digit US with leading 1', () => {
    expect(toE164Us('1-555-123-4567')).toBe('+15551234567');
  });

  it('returns null for empty or invalid input', () => {
    expect(toE164Us('')).toBeNull();
    expect(toE164Us(null)).toBeNull();
    expect(toE164Us('123')).toBeNull();
  });

  it('normalizes common US input formats to the same E.164 value', () => {
    expect(toE164Us('(470) 480-4679')).toBe('+14704804679');
    expect(toE164Us('470-480-4679')).toBe('+14704804679');
    expect(toE164Us('+1 470 480 4679')).toBe('+14704804679');
    expect(toE164Us('470.480.4679')).toBe('+14704804679');
    expect(toE164Us('4704804679')).toBe('+14704804679');
  });

  it('returns null for short/invalid numbers and non-string input', () => {
    expect(toE164Us('480-4679')).toBeNull(); // 7 digits — too short
    expect(toE164Us('abc')).toBeNull();
    expect(toE164Us(undefined)).toBeNull();
    expect(toE164Us(4704804679)).toBeNull(); // numbers are rejected, only strings accepted
  });
});
