/**
 * The record a Company Admin's edits leave on a draft, and the submission rule
 * built on it. See `shared/companyEdits.js` for the protocol.
 */

jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());

const {
    assertCompanyEditsSeen,
    clientCompanyEdits,
    companyEditsOf,
    companyRevisionOf,
    mergeCompanyEdits,
    seenRevisionOf,
} = require('../../shared/companyEdits');

/** A revision is the edit's time in milliseconds. */
const EDITED_AT = 1791300000000;

describe('what a draft records about edits', () => {
    it('reads no revision and no edits on a draft nobody edited', () => {
        expect(companyRevisionOf({})).toBe(0);
        expect(companyRevisionOf(null)).toBe(0);
        expect(companyEditsOf({})).toEqual({});
        expect(companyEditsOf(undefined)).toEqual({});
    });

    it('ignores anything that is not a revision', () => {
        expect(companyRevisionOf({ companyRevision: -1 })).toBe(0);
        expect(companyRevisionOf({ companyRevision: 1.5 })).toBe(0);
        expect(companyRevisionOf({ companyRevision: '9' })).toBe(0);
        expect(companyEditsOf({
            companyEdits: { employers: EDITED_AT, city: 'x', phone: -4, zip: 0, state: 2.5 },
        })).toEqual({ employers: EDITED_AT });
        expect(companyEditsOf({ companyEdits: ['employers'] })).toEqual({});
    });

    it('merges two drafts at the later revision of each answer, in either order', () => {
        const older = { companyEdits: { employers: EDITED_AT, city: EDITED_AT + 5 } };
        const newer = { companyEdits: { employers: EDITED_AT + 9, zip: EDITED_AT + 1 } };
        const both = { employers: EDITED_AT + 9, city: EDITED_AT + 5, zip: EDITED_AT + 1 };

        expect(mergeCompanyEdits(older, newer)).toEqual(both);
        expect(mergeCompanyEdits(newer, older)).toEqual(both);
        expect(mergeCompanyEdits(null, undefined)).toEqual({});
    });

    it('hands a browser the revision and the edits, and none of the answers', () => {
        expect(clientCompanyEdits({
            companyRevision: EDITED_AT,
            companyEdits: { city: EDITED_AT },
            formData: { city: 'Dallas' },
        })).toEqual({ companyRevision: EDITED_AT, companyEdits: { city: EDITED_AT } });
        expect(clientCompanyEdits({})).toEqual({ companyRevision: 0, companyEdits: {} });
    });
});

describe('the revision a browser says it holds', () => {
    it.each([0, EDITED_AT, Number.MAX_SAFE_INTEGER])('takes %p as said', (value) => {
        expect(seenRevisionOf(value)).toBe(value);
    });

    it.each([undefined, null, '5', -1, 2.5, Number.MAX_SAFE_INTEGER + 2, {}])(
        'reads %p as a browser that predates edits',
        (value) => {
            expect(seenRevisionOf(value)).toBeNull();
        },
    );
});

describe('a submission from a copy that has not taken the latest edits', () => {
    const edited = { companyRevision: EDITED_AT };

    it('is refused, and sends the driver to the Review page', () => {
        let refusal;
        try {
            assertCompanyEditsSeen(EDITED_AT - 1, edited);
        } catch (error) {
            refusal = error;
        }
        expect(refusal).toMatchObject({ code: 'failed-precondition' });
        expect(refusal.message).toMatch(/Review page/);
        expect(refusal.details).toEqual({
            issues: [{ code: 'carrier-updated', semanticStep: 'review', fieldId: null }],
        });
    });

    it('passes at the current revision, past it, and on a draft nobody edited', () => {
        expect(() => assertCompanyEditsSeen(EDITED_AT, edited)).not.toThrow();
        expect(() => assertCompanyEditsSeen(EDITED_AT + 1, edited)).not.toThrow();
        expect(() => assertCompanyEditsSeen(0, {})).not.toThrow();
        expect(() => assertCompanyEditsSeen(0, null)).not.toThrow();
    });

    it('never applies to a browser that did not say which revision it holds', () => {
        expect(() => assertCompanyEditsSeen(null, edited)).not.toThrow();
    });
});
