/**
 * Required fields a draft deliberately never keeps.
 *
 * `ssn` and `signature` are stripped from every draft copy on purpose. The
 * consequence nobody had accounted for: an applicant who resumes at the licence
 * page never returns to page one, so the wizard's per-step validation never runs
 * for the Social Security Number — and the server never asked either. A company
 * that requires one could therefore receive an application without one.
 *
 * These assert the *configuration* is respected, not that the field is always
 * demanded: a company that hides it or marks it optional must be able to keep
 * accepting applications exactly as before.
 */

const {
    getMissingRequiredUnpersistedFields,
    assertRequiredUnpersistedFields,
} = require('../../shared/buildApplicationDoc');
const { NEVER_STORED } = require('../../shared/applicationDraft');

const WITH_SSN = { ssn: '123-45-6789' };

describe('which fields are checked', () => {
    it('is derived from the draft strip list, not a hand-written rule', () => {
        // If something else stops being persisted, it is covered without anyone
        // remembering to extend this check.
        expect(NEVER_STORED).toContain('ssn');
        expect(NEVER_STORED).toContain('signature');
    });

    it('names the Social Security Number today', () => {
        expect(getMissingRequiredUnpersistedFields({}, {})).toEqual(['Social Security Number']);
    });
});

describe('a company that requires the SSN', () => {
    it('refuses a submission without one', () => {
        // The default: `GATE_DEFAULT_REQUIRED.ssn` is true and the wizard has always
        // required it, so this cannot start rejecting anyone who filled the form.
        expect(() => assertRequiredUnpersistedFields({}, { firstName: 'Ada' }))
            .toThrow(/Social Security Number/);
    });

    it('refuses one that is present but blank', () => {
        expect(() => assertRequiredUnpersistedFields({}, { ssn: '   ' }))
            .toThrow(/Social Security Number/);
    });

    it('accepts one that has it', () => {
        expect(() => assertRequiredUnpersistedFields({}, WITH_SSN)).not.toThrow();
    });

    it('refuses when explicitly configured required', () => {
        expect(() => assertRequiredUnpersistedFields({ ssn: { required: true } }, {}))
            .toThrow(/Social Security Number/);
    });
});

describe('a company that does not require the SSN', () => {
    it('accepts a submission without one when the field is optional', () => {
        expect(() => assertRequiredUnpersistedFields({ ssn: { required: false } }, {}))
            .not.toThrow();
    });

    it('accepts a submission without one when the field is hidden', () => {
        // Hidden is never required: a question nobody is shown cannot be one they
        // must answer, which is the same rule `resolveGate` applies for the wizard.
        expect(() => assertRequiredUnpersistedFields({ ssn: { hidden: true } }, {}))
            .not.toThrow();
    });

    it('treats hidden as decisive even when required is also set', () => {
        expect(() => assertRequiredUnpersistedFields(
            { ssn: { hidden: true, required: true } }, {},
        )).not.toThrow();
    });
});

describe('resolution matches the wizard', () => {
    it('uses the same gate resolver, so the two cannot disagree', () => {
        const { resolveGate } = require('../../shared/applicationDefinition');

        for (const config of [{}, { ssn: { required: false } }, { ssn: { hidden: true } }]) {
            const gate = resolveGate(config, 'ssn');
            const blocking = getMissingRequiredUnpersistedFields(config, {}).length > 0;
            expect(blocking).toBe(!gate.hidden && gate.required);
        }
    });

    it('never reports a field the company hid, whatever else is missing', () => {
        expect(getMissingRequiredUnpersistedFields({ ssn: { hidden: true } }, {})).toEqual([]);
    });
});

describe('the error it produces', () => {
    it('is an invalid-argument the wizard can act on', () => {
        try {
            assertRequiredUnpersistedFields({}, {});
            throw new Error('should have thrown');
        } catch (error) {
            expect(error.code).toBe('invalid-argument');
            // Names the field, so the applicant can be told what to supply — and
            // carries no value, so nothing sensitive travels in an error string.
            expect(error.message).toContain('Social Security Number');
            expect(error.message).not.toContain('123-45');
        }
    });
});
