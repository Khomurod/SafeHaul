const { normalizePhoneForKeychain, normalizePhone, isLikelyValidPhone } = require('../../utils/phoneUtils');

describe('phoneUtils exports', () => {
  it('re-exports normalizePhone from shared module', () => {
    expect(typeof normalizePhone).toBe('function');
    expect(normalizePhone('(555) 123-4567')).toBe('+15551234567');
  });
});

describe('normalizePhoneForKeychain', () => {
  it('normalizes US numbers to E.164 with plus prefix', () => {
    expect(normalizePhoneForKeychain('(555) 123-4567')).toBe('+5551234567');
  });

  it('preserves leading plus and strips formatting', () => {
    expect(normalizePhoneForKeychain('+1 555 123 4567')).toBe('+15551234567');
  });

  it('throws on empty input', () => {
    expect(() => normalizePhoneForKeychain('')).toThrow('Invalid phone number');
  });
});

describe('isLikelyValidPhone', () => {
  it('rejects the bare "+", empty, and punctuation/whitespace-only values', () => {
    // These are the exact shapes that produced "No authentication key found for +".
    expect(isLikelyValidPhone('+')).toBe(false);
    expect(isLikelyValidPhone('')).toBe(false);
    expect(isLikelyValidPhone('   ')).toBe(false);
    expect(isLikelyValidPhone('---')).toBe(false);
    expect(isLikelyValidPhone('()')).toBe(false);
  });

  it('rejects non-string / nullish input', () => {
    expect(isLikelyValidPhone(null)).toBe(false);
    expect(isLikelyValidPhone(undefined)).toBe(false);
    expect(isLikelyValidPhone(12345)).toBe(false);
  });

  it('rejects numbers with too few digits', () => {
    expect(isLikelyValidPhone('+1')).toBe(false);
    expect(isLikelyValidPhone('+12345')).toBe(false); // 5 digits
  });

  it('accepts real E.164 and formatted numbers', () => {
    expect(isLikelyValidPhone('+15551234567')).toBe(true);
    expect(isLikelyValidPhone('(555) 123-4567')).toBe(true);
    expect(isLikelyValidPhone('5551234567')).toBe(true);
  });
});
