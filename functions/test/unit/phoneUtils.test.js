const { normalizePhoneForKeychain, normalizePhone, isLikelyValidPhone } = require('../../utils/phoneUtils');

describe('phoneUtils exports', () => {
  it('re-exports normalizePhone from shared module', () => {
    expect(typeof normalizePhone).toBe('function');
    expect(normalizePhone('(555) 123-4567')).toBe('+15551234567');
  });
});

describe('normalizePhoneForKeychain', () => {
  it('normalizes US numbers to E.164 with plus prefix', () => {
    expect(normalizePhoneForKeychain('(555) 123-4567')).toBe('+15551234567');
  });

  it('gives a US number written any common way the same line number', () => {
    ['(555) 123-4567', '555-123-4567', '5551234567', '15551234567', '1 (555) 123-4567', '+1 555 123 4567', '+15551234567']
      .forEach((written) => expect(normalizePhoneForKeychain(written)).toBe('+15551234567'));
  });

  it('reads a number without + the way the shared normalizePhone does', () => {
    ['(555) 123-4567', '15551234567', '442079460958']
      .forEach((written) => expect(normalizePhoneForKeychain(written)).toBe(normalizePhone(written)));
  });

  it('keeps a number written with + as written, so a stored line key reads the same', () => {
    expect(normalizePhoneForKeychain('+5551234567')).toBe('+5551234567');
    expect(normalizePhoneForKeychain('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('keeps the old "+digits" form for what is too short to be a number', () => {
    expect(normalizePhoneForKeychain('12345')).toBe('+12345');
    expect(normalizePhoneForKeychain('---')).toBe('+');
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
