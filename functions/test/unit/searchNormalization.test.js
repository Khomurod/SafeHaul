/**
 * Runs the shared behavioral vectors against the CANONICAL (CommonJS) copy of
 * searchNormalization. The ESM mirror in src/shared/utils runs the exact same
 * vectors via vitest — a change to either copy fails the other suite until the
 * two implementations match again.
 */
const vectors = require('../../shared/searchNormalization.vectors.json');
const impl = require('../../shared/searchNormalization');

describe('searchNormalization (functions copy) — shared vectors', () => {
  for (const [fnName, cases] of Object.entries(vectors)) {
    if (fnName === '//') continue;
    describe(fnName, () => {
      it(`is exported`, () => {
        expect(typeof impl[fnName]).toBe('function');
      });
      cases.forEach(({ input, expected }, index) => {
        it(`vector #${index}: ${JSON.stringify(input)}`, () => {
          expect(impl[fnName](input)).toEqual(expected);
        });
      });
    });
  }

  it('fullNameNormalized handles missing last name without trailing space', () => {
    const fields = impl.buildApplicationSearchFields({ firstName: 'Cher' });
    expect(fields.fullNameNormalized).toBe('cher');
  });
});
