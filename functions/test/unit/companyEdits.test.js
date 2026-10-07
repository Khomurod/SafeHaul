/**
 * The record a Company Admin's edits leave on a draft, and the submission rule
 * built on it. See `shared/companyEdits.js` for the protocol.
 */

jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());

const {
    EDITABLE_FIELDS,
    assertCompanyEditsSeen,
    clientCompanyEdits,
    companyEditsOf,
    companyRevisionOf,
    fitsField,
    mergeCompanyEdits,
    nextCompanyRevision,
    sameAnswer,
    seenRevisionOf,
} = require('../../shared/companyEdits');
const SECTIONS = require('../../shared/applicationSections.json');
const DRIVER_ONLY_FIELDS = require('../../shared/driverOnlyFields.json');

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

describe('what a Company Admin may change', () => {
    it('is every answer the application asks for and the company questions, never one only the driver gives', () => {
        const asked = SECTIONS.flatMap((section) => section.fields.map((field) => field.id));

        expect(EDITABLE_FIELDS).toEqual(expect.arrayContaining(['city', 'employers', 'cdl-front', 'customAnswers']));
        for (const field of DRIVER_ONLY_FIELDS) expect(EDITABLE_FIELDS).not.toContain(field);
        expect(EDITABLE_FIELDS).toHaveLength(asked.filter((id) => !DRIVER_ONLY_FIELDS.includes(id)).length + 1);
    });

    it.each([
        ['a value', 'city', 'Dallas'],
        ['a number', 'expSemiTrailerExp', 4],
        ['a multiple choice', 'endorsements', ['H', 'N']],
        ['a cleared answer', 'employers', null],
        ['rows of fields', 'employers', [{ companyName: 'Acme', startDate: '2019-04', mayContact: 'yes' }]],
        ['an upload', 'cdl-front', { name: 'front.jpg', storagePath: 'companies/c/applications/guest_uploads/f.jpg' }],
        ['the company questions', 'customAnswers', { q1: 'yes', q2: ['a', 'b'], q3: { name: 'f.pdf', storagePath: 'p' } }],
    ])('takes %s in the shape the wizard stores', (_what, field, value) => {
        expect(fitsField(field, value)).toBe(true);
    });

    it.each([
        ['rows given as text', 'employers', 'Acme'],
        ['a row that is a list', 'employers', [['Acme']]],
        ['a row field that is a set of fields', 'previousAddresses', [{ street: { line: 1 } }]],
        ['an upload given as text', 'cdl-front', 'companies/c/f.jpg'],
        ['an upload with nowhere it is stored', 'cdl-front', { name: 'front.jpg' }],
        ['a set of fields for one value', 'city', { name: 'Dallas' }],
        ['the company questions as a list', 'customAnswers', ['yes']],
        ['a company answer that is a set of fields', 'customAnswers', { q1: { a: 1 } }],
        ['an answer the application does not ask', 'notAnAnswer', 'x'],
    ])('refuses %s', (_what, field, value) => {
        expect(fitsField(field, value)).toBe(false);
    });

    it('compares two copies of an answer by what they say, not the order of their fields', () => {
        expect(sameAnswer([{ a: 1, b: 2 }], [{ b: 2, a: 1 }])).toBe(true);
        expect(sameAnswer({ q1: 'x', q2: 'y' }, { q2: 'y', q1: 'x' })).toBe(true);
        expect(sameAnswer(undefined, null)).toBe(true);
        expect(sameAnswer('', null)).toBe(false);
        expect(sameAnswer([{ a: 1 }, { a: 2 }], [{ a: 2 }, { a: 1 }])).toBe(false);
    });

    it('stamps a new edit with its time, or one past the draft\'s latest when the clock lags', () => {
        expect(nextCompanyRevision({}, EDITED_AT)).toBe(EDITED_AT);
        expect(nextCompanyRevision({ companyRevision: EDITED_AT - 1 }, EDITED_AT)).toBe(EDITED_AT);
        expect(nextCompanyRevision({ companyRevision: EDITED_AT + 9 }, EDITED_AT)).toBe(EDITED_AT + 10);
    });
});
