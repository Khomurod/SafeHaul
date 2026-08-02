// A5 coverage: frontend PII scrubber (mirrors functions/shared/scrub.js).
import { describe, it, expect } from 'vitest';
import { scrub, scrubString } from '../shared/utils/scrub';

describe('scrubString (frontend value masking)', () => {
  it('masks SSN, email, and phone', () => {
    expect(scrubString('ssn 123-45-6789')).toBe('ssn [ssn]');
    expect(scrubString('mail a.b+c@example.com')).toBe('mail [email]');
    expect(scrubString('call (555) 123-4567')).toBe('call [phone]');
  });

  it('avoids false positives on ordinary numbers', () => {
    expect(scrubString('build 1.2.3 #42')).toBe('build 1.2.3 #42');
  });
});

describe('scrub (frontend key redaction + traversal)', () => {
  it('redacts PII-named keys and masks nested values', () => {
    const out = scrub({
      password: 'x',
      token: 'y',
      user: { email: 'a@b.com', name: 'Ada' },
      breadcrumb: { message: 'phoned 555-123-4567' },
    });
    expect(out.password).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    expect(out.user.email).toBe('[redacted]');
    expect(out.user.name).toBe('Ada');
    expect(out.breadcrumb.message).toBe('phoned [phone]');
  });

  it('survives cycles and returns primitives unchanged', () => {
    const a = { secret: 's' };
    a.self = a;
    const out = scrub(a);
    expect(out.secret).toBe('[redacted]');
    expect(out.self).toBe(a);
    expect(scrub(7)).toBe(7);
    expect(scrub(null)).toBe(null);
  });

  it('never throws', () => {
    expect(() => scrub(undefined)).not.toThrow();
  });
});
