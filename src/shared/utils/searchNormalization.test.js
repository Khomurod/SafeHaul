/**
 * Runs the shared behavioral vectors against the ESM mirror of
 * searchNormalization. The canonical CommonJS copy in functions/shared runs
 * the exact same vectors via jest — a change to either copy fails the other
 * suite until the two implementations match again.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as impl from './searchNormalization';

const vectors = JSON.parse(
    fs.readFileSync(
        path.resolve(__dirname, '../../../functions/shared/searchNormalization.vectors.json'),
        'utf8',
    ),
);

describe('searchNormalization (src mirror) — shared vectors', () => {
    for (const [fnName, cases] of Object.entries(vectors)) {
        if (fnName === '//') continue;
        describe(fnName, () => {
            it('is exported', () => {
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
