/**
 * PEV — the signature normaliser (functions/employmentVerification/signature.js).
 *
 * Until 2026-09-06 the server accepted any string that started with
 * `data:image`, decoded whatever followed and wrote it to Cloud Storage as a
 * PNG. Every refusal below is a shape that would have reached Storage, the
 * response record or the DQ-file PDF under that rule.
 */
jest.mock('firebase-functions/v2/https', () => ({
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

const { HttpsError } = require('firebase-functions/v2/https');
const {
  normaliseSignature,
  TYPED_SIGNATURE_MAX_LENGTH,
  DRAWN_SIGNATURE_MAX_BASE64_LENGTH,
} = require('../../employmentVerification/signature');

// The smallest valid PNG: one transparent pixel.
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const DRAWN = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Control characters are spelled by code so none sits literally in this file.
const START_OF_HEADING = String.fromCharCode(1);
const DELETE = String.fromCharCode(127);
const NEXT_LINE = String.fromCharCode(133);

function refusal(signatureData, signatureMethod) {
  try {
    normaliseSignature(signatureData, signatureMethod);
  } catch (error) {
    return error;
  }
  return null;
}

describe('normaliseSignature', () => {
  describe('no signature', () => {
    it.each([
      [undefined, undefined],
      [null, null],
      ['', null],
      [null, undefined],
      [null, ''],
    ])('treats %p with method %p as no signature', (data, method) => {
      expect(normaliseSignature(data, method)).toEqual({ kind: 'none' });
    });

    it('refuses a method that arrives without a signature', () => {
      const error = refusal(null, 'typed');
      expect(error).toMatchObject({ code: 'invalid-argument' });
      expect(error.message).toMatch(/without a signature/);
    });
  });

  describe('drawn', () => {
    it('accepts a PNG data URL and returns the decoded image', () => {
      const result = normaliseSignature(DRAWN, 'drawn');
      expect(result.kind).toBe('drawn');
      expect(Buffer.isBuffer(result.png)).toBe(true);
      expect(result.png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    });

    it('accepts a PNG from an older client that sends no method', () => {
      expect(normaliseSignature(DRAWN, undefined).kind).toBe('drawn');
    });

    it.each([
      ['a JPEG', `data:image/jpeg;base64,${ONE_PIXEL_PNG_BASE64}`],
      ['an SVG', 'data:image/svg+xml;base64,PHN2Zy8+'],
      ['a bare base64 string', ONE_PIXEL_PNG_BASE64],
      ['a javascript: URL', 'javascript:alert(1)'],
      ['a PNG data URL with nothing after the comma', 'data:image/png;base64,'],
      ['a payload that is not base64', 'data:image/png;base64,***not*base64***'],
      ['unpadded base64', `data:image/png;base64,${ONE_PIXEL_PNG_BASE64.slice(0, -2)}`],
      ['base64 of something that is not a PNG', `data:image/png;base64,${Buffer.from('GIF89a not a png').toString('base64')}`],
    ])('refuses %s', (_label, data) => {
      expect(refusal(data, undefined)).toMatchObject({ code: 'invalid-argument' });
    });

    it('refuses a payload over the size ceiling before decoding it', () => {
      const oversized = `data:image/png;base64,${'A'.repeat(DRAWN_SIGNATURE_MAX_BASE64_LENGTH + 4)}`;
      const error = refusal(oversized, 'drawn');
      expect(error).toMatchObject({ code: 'invalid-argument' });
      expect(error.message).toMatch(/too large/);
    });
  });

  describe('typed', () => {
    it('accepts TEXT_SIGNATURE:<name> and returns the trimmed name', () => {
      expect(normaliseSignature('TEXT_SIGNATURE:  Alex Employer ', 'typed'))
        .toEqual({ kind: 'typed', name: 'Alex Employer' });
    });

    it('accepts a typed mark from a client that sends no method', () => {
      expect(normaliseSignature('TEXT_SIGNATURE:Alex Employer', undefined).kind).toBe('typed');
    });

    it('keeps accents and non-Latin letters: a name is whatever the person is called', () => {
      expect(normaliseSignature('TEXT_SIGNATURE:José Núñez Ибрагимов', 'typed').name).toBe('José Núñez Ибрагимов');
    });

    it('accepts a name exactly at the ceiling', () => {
      const atCeiling = `TEXT_SIGNATURE:${'x'.repeat(TYPED_SIGNATURE_MAX_LENGTH)}`;
      expect(normaliseSignature(atCeiling, 'typed').name).toHaveLength(TYPED_SIGNATURE_MAX_LENGTH);
    });

    it.each([
      ['one character', 'TEXT_SIGNATURE:A'],
      ['only whitespace', 'TEXT_SIGNATURE:    '],
      ['nothing', 'TEXT_SIGNATURE:'],
      ['a C0 control character', `TEXT_SIGNATURE:Alex${START_OF_HEADING}Employer`],
      ['a newline', 'TEXT_SIGNATURE:Alex\nEmployer'],
      ['DEL', `TEXT_SIGNATURE:Alex${DELETE}Employer`],
      ['a C1 control character', `TEXT_SIGNATURE:Alex${NEXT_LINE}Employer`],
      ['more than the ceiling', `TEXT_SIGNATURE:${'x'.repeat(TYPED_SIGNATURE_MAX_LENGTH + 1)}`],
    ])('refuses a typed mark with %s', (_label, data) => {
      expect(refusal(data, 'typed')).toMatchObject({ code: 'invalid-argument' });
    });
  });

  describe('the method claim', () => {
    it('refuses "typed" on a PNG', () => {
      expect(refusal(DRAWN, 'typed').message).toMatch(/does not match/);
    });

    it('refuses "drawn" on a typed name', () => {
      expect(refusal('TEXT_SIGNATURE:Alex Employer', 'drawn').message).toMatch(/does not match/);
    });

    it('refuses a method it does not know', () => {
      expect(refusal(DRAWN, 'stamped').message).toMatch(/"drawn" or "typed"/);
    });
  });

  describe('shape', () => {
    it.each([[12345], [{ data: DRAWN }], [[DRAWN]], [true]])(
      'refuses %p: the signature must be a string',
      (data) => {
        expect(refusal(data, undefined)).toMatchObject({ code: 'invalid-argument' });
      },
    );

    it('throws nothing but an invalid-argument HttpsError', () => {
      const bad = [
        12345,
        'nonsense',
        'data:image/png;base64,***',
        'TEXT_SIGNATURE:A',
        `TEXT_SIGNATURE:Alex${START_OF_HEADING}`,
        `${DRAWN}=`,
      ];
      for (const data of bad) {
        const error = refusal(data, undefined);
        expect(error).toBeInstanceOf(HttpsError);
        expect(error.code).toBe('invalid-argument');
      }
      const methodWithoutMark = refusal(null, 'drawn');
      expect(methodWithoutMark).toBeInstanceOf(HttpsError);
      expect(methodWithoutMark.code).toBe('invalid-argument');
    });
  });
});
