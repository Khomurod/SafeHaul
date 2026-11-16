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

/** The code between the `--- body ---` and `--- exports ---` markers; the marker line names the other file. */
const bodyOf = (file) => {
    const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
    const start = source.indexOf('// --- body ---');
    const end = source.indexOf('// --- exports ---');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end).split('\n').slice(2).join('\n');
};

describe('employmentCoverage: parity with functions/shared', () => {
    it('has the same body as the server copy, character for character', () => {
        expect(bodyOf('./employmentCoverage.js')).toBe(bodyOf('../../../functions/shared/employmentCoverage.js'));
    });
});

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
