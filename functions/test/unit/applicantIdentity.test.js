/**
 * How a resumed application's identity facts are compared
 * (`shared/applicantIdentity.js`), on the check values the wizard's mirror runs
 * too (`src/shared/utils/applicantIdentity.test.js`), and that the draft store
 * keys and matches with exactly these functions. All identities are artificial.
 */
jest.mock('../../firebaseAdmin', () => ({ admin: { firestore: { FieldValue: {}, Timestamp: {} } }, db: {} }));

const vectors = require('../../shared/applicantIdentity.vectors.json');
const identity = require('../../shared/applicantIdentity');
const draft = require('../../shared/applicationDraft');

describe('applicantIdentity — shared check values', () => {
    for (const [fnName, cases] of Object.entries(vectors)) {
        if (fnName === '//') continue;
        it.each(cases.map(({ input, expected }) => [JSON.stringify(input), input, expected]))(
            `${fnName}(%s)`,
            (_label, input, expected) => {
                expect(identity[fnName](input)).toBe(expected);
            },
        );
    }
});

describe('the draft store', () => {
    it('compares with these same functions', () => {
        expect(draft.normalizeSsn).toBe(identity.normalizeSsn);
        expect(draft.normalizeName).toBe(identity.normalizeName);
        expect(draft.normalizeDob).toBe(identity.normalizeDob);
    });

    it('matches a phone typed another way, as the wizard reads it', () => {
        expect(draft.contactMatches({ contactPhone: '+1 (512) 555-0142' }, { phone: '512-555-0142' })).toBe(true);
        expect(draft.contactMatches({ contactPhone: '555-0101' }, { phone: '555-0101' })).toBe(false);
    });
});
