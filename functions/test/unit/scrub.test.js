// A5 coverage: backend PII scrubber.
const { scrub, scrubString } = require('../../shared/scrub');

describe('scrubString (value pattern masking)', () => {
  it('masks SSNs (dashed and raw 9-digit)', () => {
    expect(scrubString('ssn 123-45-6789 here')).toBe('ssn [ssn] here');
    expect(scrubString('123456789')).toBe('[ssn]');
  });

  it('masks emails', () => {
    expect(scrubString('reach john.doe+tag@example.co.uk now')).toBe('reach [email] now');
  });

  it('masks US phone numbers in common formats', () => {
    expect(scrubString('call 555-123-4567')).toBe('call [phone]');
    expect(scrubString('(555) 123-4567')).toBe('[phone]');
    expect(scrubString('+1 555 123 4567')).toBe('[phone]');
    expect(scrubString('5551234567')).toBe('[phone]');
  });

  it('does not mask non-PII numbers (avoids false positives)', () => {
    expect(scrubString('version 1.2.3 build 42')).toBe('version 1.2.3 build 42');
    expect(scrubString('order #1234')).toBe('order #1234');
    expect(scrubString('@sentry/react')).toBe('@sentry/react');
  });

  it('returns non-strings unchanged', () => {
    expect(scrubString(42)).toBe(42);
    expect(scrubString(null)).toBe(null);
  });
});

describe('scrub (key redaction + deep traversal)', () => {
  it('redacts values of PII-named keys', () => {
    const out = scrub({
      password: 'hunter2',
      authToken: 'abc',
      authorization: 'Bearer xyz',
      cookie: 'session=1',
      apiKey: 'k',
      keep: 'visible',
    });
    expect(out.password).toBe('[redacted]');
    expect(out.authToken).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect(out.cookie).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
    expect(out.keep).toBe('visible');
  });

  it('recurses into nested objects and arrays', () => {
    const out = scrub({
      user: { email: 'a@b.com', name: 'Ada' },
      notes: ['call 555-123-4567', { ssn: '111-22-3333' }],
    });
    expect(out.user.email).toBe('[redacted]'); // key match
    expect(out.user.name).toBe('Ada'); // not PII, no pattern
    expect(out.notes[0]).toBe('call [phone]'); // value mask
    expect(out.notes[1].ssn).toBe('[redacted]'); // key match
  });

  it('survives circular references without hanging', () => {
    const a = { token: 'x' };
    a.self = a;
    const out = scrub(a);
    expect(out.token).toBe('[redacted]');
    expect(out.self).toBe(a);
  });

  it('returns primitives unchanged and masks bare PII strings', () => {
    expect(scrub(5)).toBe(5);
    expect(scrub(null)).toBe(null);
    expect(scrub('a@b.com')).toBe('[email]');
  });

  it('never throws', () => {
    expect(() => scrub(undefined)).not.toThrow();
    expect(() => scrub(Symbol('x'))).not.toThrow();
  });
});
