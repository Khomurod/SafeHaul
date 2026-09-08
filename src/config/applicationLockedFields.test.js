/**
 * Employers a carrier locked: what the driver may still change, and what the
 * browser and the server must agree about.
 *
 * The parity check is the point of the file. The wizard renders a row as settled,
 * the pre-flight refuses a submission that broke it, and `submitGuestApplication`
 * refuses it again — three surfaces that would be three different rules if they
 * did not read one body of code. Everything else here is the behaviour that body
 * is supposed to have.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    employerSignature,
    isLockedEmployerRow,
    lockedEmployerIssues,
    lockedSignatureSet,
    normalizeLockedEmployers,
    reconcileLockedEmployers,
} from './applicationLockedFields';

const require = createRequire(import.meta.url);
const server = require('../../functions/shared/applicationLockedFields.js');

const bodyOf = (path) => {
    const source = readFileSync(resolve(__dirname, path), 'utf8');
    const start = source.indexOf('// --- body ---');
    const end = source.indexOf('// --- exports ---');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    // The marker line names the other file; everything after it must match.
    return source.slice(start, end).split('\n').slice(2).join('\n');
};

const ACME = { companyName: 'Acme Trucking', dotNumber: '123456' };
const BY_NAME = { companyName: 'Beta Freight', dotNumber: '' };
const LOCKED = normalizeLockedEmployers([ACME, BY_NAME]);

describe('parity with functions/shared', () => {
    it('applicationLockedFields.js has the same body as the server copy', () => {
        expect(bodyOf('./applicationLockedFields.js'))
            .toBe(bodyOf('../../functions/shared/applicationLockedFields.js'));
    });

    it.each([
        ['an untouched application', { employers: [ACME, BY_NAME] }],
        ['a locked employer removed', { employers: [BY_NAME] }],
        ['a locked name rewritten', { employers: [{ ...ACME, companyName: 'Something Else' }, BY_NAME] }],
        ['a row the driver added', { employers: [ACME, BY_NAME, { companyName: 'Their Own Job' }] }],
        ['no employers at all', {}],
    ])('agrees with the server about %s', (_label, formData) => {
        expect(lockedEmployerIssues(LOCKED, formData))
            .toEqual(server.lockedEmployerIssues(LOCKED, formData));
    });
});

describe('identifying an employer', () => {
    it('prefers the USDOT number, and normalises how it was typed', () => {
        expect(employerSignature({ companyName: 'Acme', dotNumber: 'USDOT 123456' })).toBe('dot:123456');
        expect(employerSignature({ companyName: 'Renamed', dotNumber: '123456' }))
            .toBe(employerSignature(ACME));
    });

    it('falls back to the name, case and spacing insensitive', () => {
        expect(employerSignature({ companyName: '  BETA   freight ' })).toBe('name:beta freight');
    });

    it('gives a row with neither no identity at all', () => {
        expect(employerSignature({})).toBe('');
        expect(employerSignature(null)).toBe('');
    });

    it('drops unidentifiable and duplicate rows from the lock list', () => {
        const locked = normalizeLockedEmployers([ACME, { ...ACME, companyName: 'Acme Trucking Inc' }, {}, null]);
        expect(locked).toHaveLength(1);
        expect(locked[0]).toEqual({ signature: 'dot:123456', companyName: 'Acme Trucking', dotNumber: '123456' });
    });

    it('knows which rows the wizard must present as settled', () => {
        expect(isLockedEmployerRow(ACME, LOCKED)).toBe(true);
        expect(isLockedEmployerRow({ companyName: 'Their Own Job' }, LOCKED)).toBe(false);
        expect(isLockedEmployerRow(ACME, [])).toBe(false);
        expect(lockedSignatureSet(LOCKED).has('dot:123456')).toBe(true);
    });
});

describe('what a locked employer refuses', () => {
    it('accepts an application that kept them, whatever else the driver filled in', () => {
        expect(lockedEmployerIssues(LOCKED, {
            employers: [
                { ...ACME, startDate: '2023-01-01', endDate: '2024-06-30', reasonForLeaving: 'Better route' },
                { ...BY_NAME, position: 'Driver' },
            ],
        })).toEqual([]);
    });

    it('refuses a locked employer that was removed, naming it', () => {
        const [issue] = lockedEmployerIssues(LOCKED, { employers: [BY_NAME] });
        expect(issue).toMatchObject({
            code: 'locked-employer-missing',
            severity: 'block',
            semanticStep: 'employment',
            fieldId: 'employers',
        });
        expect(issue.message).toContain('Acme Trucking');
    });

    it('refuses a rewritten name on a row locked by its USDOT number', () => {
        const [issue] = lockedEmployerIssues(LOCKED, {
            employers: [{ companyName: 'Not Acme', dotNumber: '123456' }, BY_NAME],
        });
        expect(issue.code).toBe('locked-employer-changed');
    });

    it('refuses a USDOT number appearing on a row locked by name', () => {
        const [issue] = lockedEmployerIssues(LOCKED, {
            employers: [ACME, { companyName: 'Beta Freight', dotNumber: '999999' }],
        });
        // Locked by name, so a number that arrived later changes who this is.
        expect(issue.code).toBe('locked-employer-missing');
    });

    it('says nothing about rows the driver added themselves', () => {
        expect(lockedEmployerIssues(LOCKED, {
            employers: [ACME, BY_NAME, { companyName: 'Their Own Job', dotNumber: '777' }],
        })).toEqual([]);
    });

    it('is a complete no-op for an application nobody locked anything on', () => {
        expect(lockedEmployerIssues([], { employers: [] })).toEqual([]);
        expect(lockedEmployerIssues(undefined, { employers: [ACME] })).toEqual([]);
        expect(lockedEmployerIssues(null, {})).toEqual([]);
    });
});

/**
 * Keeping the lock list in step with the rows it names.
 *
 * Four ordinary carrier edits used to produce an application the driver was
 * blocked on at submission and could not fix. Two of them cannot happen any more
 * — the carrier's editor renders a locked row's identity read-only, so a
 * signature cannot drift while the lock exists — and the other two are what this
 * function is for. All four are driven here anyway: a rule is worth stating over
 * the whole family, not only over the part that is still reachable.
 */
describe('reconciling locks against the rows', () => {
    it('drops a lock whose row the carrier deleted', () => {
        // The sharpest of the four in practice: the row's own Unlock button went
        // with the row, so nothing on the carrier's screen could even see the lock
        // that was left behind.
        expect(reconcileLockedEmployers(LOCKED, { employers: [BY_NAME] }))
            .toEqual([{ signature: 'name:beta freight', companyName: 'Beta Freight', dotNumber: '' }]);
    });

    it('drops a lock whose name was rewritten out from under it', () => {
        expect(reconcileLockedEmployers(LOCKED, {
            employers: [ACME, { ...BY_NAME, companyName: 'Beta Freight LLC' }],
        }).map((entry) => entry.signature)).toEqual(['dot:123456']);
    });

    it('drops a lock whose row has acquired a USDOT number', () => {
        // `name:beta freight` becomes `dot:998877`, and no row can satisfy the old
        // signature while carrying that number — so before this, the driver could
        // not complete the application at all.
        expect(reconcileLockedEmployers(LOCKED, {
            employers: [ACME, { ...BY_NAME, dotNumber: '998877' }],
        }).map((entry) => entry.signature)).toEqual(['dot:123456']);
    });

    it('keeps a lock whose row is still there, changed only where the driver may change it', () => {
        expect(reconcileLockedEmployers(LOCKED, {
            employers: [
                { ...ACME, startDate: '2020-01', reasonForLeaving: 'Better route' },
                BY_NAME,
            ],
        })).toEqual(LOCKED);
    });

    it('leaves rows the driver added alone, and normalises as it goes', () => {
        const reconciled = reconcileLockedEmployers(
            [{ companyName: 'Acme Trucking', dotNumber: 'USDOT 123456' }, { companyName: '', dotNumber: '' }],
            { employers: [ACME, { companyName: 'Their Own Job', dotNumber: '777' }] },
        );

        expect(reconciled).toEqual([
            { signature: 'dot:123456', companyName: 'Acme Trucking', dotNumber: '123456' },
        ]);
    });

    it('is a no-op when nothing is locked', () => {
        expect(reconcileLockedEmployers([], { employers: [ACME] })).toEqual([]);
        expect(reconcileLockedEmployers(undefined, {})).toEqual([]);
    });

    it('drops every lock when the application has no employers at all', () => {
        expect(reconcileLockedEmployers(LOCKED, {})).toEqual([]);
    });

    it('leaves nothing for `lockedEmployerIssues` to refuse', () => {
        // The property that matters, stated as one: after reconciling, the driver
        // is never blocked by a lock the application cannot satisfy.
        for (const formData of [
            { employers: [BY_NAME] },
            { employers: [ACME, { ...BY_NAME, dotNumber: '998877' }] },
            { employers: [] },
            {},
        ]) {
            expect(lockedEmployerIssues(reconcileLockedEmployers(LOCKED, formData), formData)).toEqual([]);
        }
    });
});
