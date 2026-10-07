/**
 * An unfinished application, laid out the way a submitted one reads.
 *
 * `buildDraftRecord` is pure: the same definition and snapshot builders a
 * submission uses, plus three things it deliberately leaves out. The callable
 * that serves it is pinned in `applicationDrafts.admin.test.js`; these drive the
 * builder directly.
 */

const { DRAFT_SOURCE, buildDraftRecord } = require('../../shared/draftRecord');

const COMPANY = {
    companyName: 'Acme Freight',
    applicationConfig: {},
    customQuestions: [{ id: 'q1', label: 'Willing to run a dedicated lane?' }],
};

function answersOf(record) {
    return new Map(record.sections.flatMap((section) => section.answers).map((answer) => [answer.fieldId, answer]));
}

describe('buildDraftRecord', () => {
    it('reads like a submission: labelled answers, custom questions by their wording', () => {
        const record = buildDraftRecord({
            company: COMPANY,
            formData: { firstName: 'Dana', cdlNumber: 'D9988776', customAnswers: { q1: 'Yes' } },
        });

        expect(record.frozen).toBe(true);
        expect(answersOf(record).get('firstName')).toMatchObject({ label: 'First Name', displayValue: 'Dana' });
        expect(record.customAnswers[0]).toMatchObject({ label: 'Willing to run a dedicated lane?', displayValue: 'Yes' });
        expect(record.provenance).toEqual({ source: DRAFT_SOURCE, notes: [] });
    });

    it('drops what an explicit No dropped, as the review and the submission do', () => {
        const record = buildDraftRecord({
            company: COMPANY,
            formData: {
                'has-violations': 'no',
                violations: [{ date: '2025-02-01', charge: 'Speeding', location: 'Dallas, TX' }],
            },
        });

        expect(answersOf(record).get('violations').rows).toEqual([]);
    });

    it('carries no agreements, no signature and no submission time', () => {
        const record = buildDraftRecord({ company: COMPANY, formData: { firstName: 'Dana' } });

        expect(record.agreements).toEqual([]);
        expect(record.signature).toBeNull();
        expect(record.submittedAt).toBeNull();
    });

    it('leaves out the SSN rather than calling it "not provided"', () => {
        // Asked by default (`GATE_DEFAULT_REQUIRED.ssn`), so a submission would list
        // it; a draft never stores one, so here it would always read as unanswered.
        const record = buildDraftRecord({ company: COMPANY, formData: { firstName: 'Dana', ssn: '123456789' } });

        expect(answersOf(record).has('ssn')).toBe(false);
        expect(JSON.stringify(record)).not.toContain('123456789');
    });

    it('measures employment coverage against today', () => {
        const now = new Date('2026-10-06T12:00:00Z');
        const record = buildDraftRecord({
            company: COMPANY,
            formData: { employers: [{ companyName: 'Lone Star', startDate: '2025-10', endDate: 'Present' }] },
            now,
        });

        expect(record.employmentCoverage).toMatchObject({ isComplete: false });
        expect(record.employmentCoverage.coveredMonths).toBeGreaterThan(0);
    });

    it('survives a draft with no answers at all', () => {
        const record = buildDraftRecord({ company: COMPANY, formData: undefined });

        expect(Array.isArray(record.sections)).toBe(true);
        expect(record.customAnswers[0]).toMatchObject({ questionId: 'q1', displayValue: null });
    });
});
