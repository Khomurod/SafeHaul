const {
  SIGNING_DATE_KEY,
  SIGNING_DATE_PLACEHOLDER,
  formatSignedDate,
  resolveSignedDateValue,
} = require('../../shared/signedDate');

// The server-side half of the mirror. `src/features/signing/utils/signedDate.test.js`
// drives the identical cases against the browser copy; the two lists are meant to
// be read side by side, because the two modules cannot import each other.
const PREPARED_ON = new Date('2026-05-07T12:00:00Z');
const SIGNED_ON = new Date('2026-09-11T12:00:00Z');

describe('shared/signedDate', () => {
  it('exports the canonical key and placeholder', () => {
    expect(SIGNING_DATE_KEY).toBe('current_date');
    expect(SIGNING_DATE_PLACEHOLDER).toBe('{{current_date}}');
  });

  it('stamps a field bound to the signing date', () => {
    expect(
      resolveSignedDateValue({ bindingKey: SIGNING_DATE_KEY, defaultValue: '' }, SIGNED_ON),
    ).toBe('September 11, 2026');
  });

  it('stamps a document sent with the placeholder still in place', () => {
    expect(resolveSignedDateValue({ defaultValue: SIGNING_DATE_PLACEHOLDER }, SIGNED_ON))
      .toBe('September 11, 2026');
  });

  it('replaces the creation date already baked into an in-flight document', () => {
    const field = { bindingKey: SIGNING_DATE_KEY, defaultValue: formatSignedDate(PREPARED_ON) };
    expect(field.defaultValue).toBe('May 7, 2026');
    expect(resolveSignedDateValue(field, SIGNED_ON)).toBe('September 11, 2026');
  });

  it('keeps the surrounding words when the token sits inside a sentence', () => {
    expect(
      resolveSignedDateValue({ defaultValue: 'Signed on {{current_date}} at the terminal' }, SIGNED_ON),
    ).toBe('Signed on September 11, 2026 at the terminal');
  });

  it('tolerates the spacing and casing an author may type', () => {
    expect(resolveSignedDateValue({ defaultValue: '{{  CURRENT_DATE  }}' }, SIGNED_ON))
      .toBe('September 11, 2026');
  });

  it('leaves every other date alone', () => {
    [
      { bindingKey: 'dob', defaultValue: 'January 2, 1980' },
      { bindingKey: '', defaultValue: 'Hire date: March 1, 2026' },
      { bindingKey: 'cdl_expiration', defaultValue: 'August 30, 2029' },
      { type: 'date', bindingKey: '', defaultValue: '' },
      { defaultValue: '{{date}}' },
      {},
      undefined,
    ].forEach((field) => {
      expect(resolveSignedDateValue(field, SIGNED_ON)).toBeNull();
    });
  });

  it('renders in UTC so the screen and the sealed PDF cannot disagree', () => {
    expect(formatSignedDate(new Date('2026-09-11T23:30:00Z'))).toBe('September 11, 2026');
    expect(formatSignedDate(new Date('2026-09-12T00:30:00Z'))).toBe('September 12, 2026');
  });
});
