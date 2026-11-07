/**
 * The wizard's "Finish later" reads a resumed application's identity facts as
 * the server keys it. This mirror's body must equal the server copy's
 * character for character, and both run the shared check values in
 * `functions/shared/applicantIdentity.vectors.json` (the server's own suite runs
 * them too). All identities are artificial.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as impl from './applicantIdentity';

const vectors = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../functions/shared/applicantIdentity.vectors.json'), 'utf8'),
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

describe('applicantIdentity: parity with functions/shared', () => {
    it('has the same body as the server copy, character for character', () => {
        expect(bodyOf('./applicantIdentity.js')).toBe(bodyOf('../../../functions/shared/applicantIdentity.js'));
    });
});

describe('applicantIdentity (src mirror) — shared check values', () => {
    for (const [fnName, cases] of Object.entries(vectors)) {
        if (fnName === '//') continue;
        it.each(cases.map(({ input, expected }) => [JSON.stringify(input), input, expected]))(
            `${fnName}(%s)`,
            (_label, input, expected) => {
                expect(impl[fnName](input)).toBe(expected);
            },
        );
    }
});
