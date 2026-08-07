/**
 * Runs the shared behavioral vectors against the ESM mirror of
 * employmentCoverage. The canonical CommonJS copy in functions/shared runs the
 * exact same vectors via jest — a change to either copy fails the other suite
 * until the two implementations match again.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as impl from './employmentCoverage';

const vectors = JSON.parse(
    fs.readFileSync(
        path.resolve(__dirname, '../../../functions/shared/employmentCoverage.vectors.json'),
        'utf8',
    ),
);

describe('employmentCoverage (src mirror) — shared vectors', () => {
    for (const [fnName, cases] of Object.entries(vectors)) {
        if (fnName === '//') continue;
        describe(fnName, () => {
            it('is exported', () => {
                expect(typeof impl[fnName]).toBe('function');
            });
            cases.forEach((testCase, index) => {
                const args = Array.isArray(testCase.input) ? testCase.input : [testCase.input];
                it(`vector #${index}${testCase['//'] ? `: ${testCase['//']}` : ''}`, () => {
                    expect(impl[fnName](...args)).toEqual(testCase.expected);
                });
            });
        });
    }
});
