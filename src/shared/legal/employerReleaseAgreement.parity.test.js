import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import * as site from './employerReleaseAgreement';
import { AGREEMENT_SET_VERSION } from '@features/driver-app/hooks/useApplicationAgreements';

/*
 * The consent step renders the release from the driver's rows; the server
 * freezes it from the submitted rows. Both must build the same text and judge
 * the same acceptance, or the record would hold wording that was not on screen.
 */
const require = createRequire(import.meta.url);
const server = require('../../../functions/shared/employerReleaseAgreement.js');

const ROWS = [
    ['none', []],
    ['not a list', null],
    ['one', [{ companyName: 'Old Carrier Inc' }]],
    ['legacy name field', [{ name: 'Legacy Lines' }]],
    ['spacing and case repeats', [{ companyName: '  Old   Carrier Inc ' }, { companyName: 'old carrier inc' }, { companyName: 'Two LLC' }]],
    ['blank and odd rows', [{ companyName: '' }, null, 'x', { companyName: 42 }, { name: 'Kept Co' }]],
];

describe('previous employers release parity', () => {
    it('asks the server for the set that holds the release', () => {
        const { CURRENT_AGREEMENT_VERSION } = require('../../../functions/shared/legalAgreements.js');
        expect(AGREEMENT_SET_VERSION).toBe(CURRENT_AGREEMENT_VERSION);
    });

    it.each(ROWS)('names the same employers: %s', (_label, rows) => {
        expect(site.releaseEmployerNames(rows)).toEqual(server.releaseEmployerNames(rows));
    });

    it.each(ROWS)('builds the same text: %s', (_label, rows) => {
        const names = server.releaseEmployerNames(rows);
        expect(site.withEmployerStatements('BODY', server.RELEASE_STATEMENT_V3, names))
            .toBe(server.withEmployerStatements('BODY', server.RELEASE_STATEMENT_V3, names));
    });

    it.each([
        ['same list', { employersShown: ['A', 'B'] }, ['A', 'B']],
        ['other order', { employersShown: ['B', 'A'] }, ['A', 'B']],
        ['one more since', { employersShown: ['A'] }, ['A', 'B']],
        ['no list recorded', { accepted: true }, ['A']],
        ['no evidence', null, ['A']],
    ])('judges an acceptance the same: %s', (_label, evidence, names) => {
        expect(site.shownWithEmployers(evidence, names)).toBe(server.shownWithEmployers(evidence, names));
    });
});
