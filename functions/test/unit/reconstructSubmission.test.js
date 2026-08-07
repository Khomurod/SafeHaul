// Rebuilding a record for an application that predates preservation.
//
// The one rule everything here serves: recover what the evidence supports, say
// plainly what it does not, and invent nothing in between.

const {
    answersFrom,
    certifiedAt,
    reconstructSubmissionSnapshot,
    toIso,
} = require('../../shared/reconstructSubmission');
const { renderApplicationPdf } = require('../../shared/pdf/applicationDocument');

const QUESTION_ID = '9f2c1a44-77bd-4e21-9f0e-1c2b3d4e5f60';

const company = (over = {}) => ({
    companyName: 'Northwind Freight Systems',
    dotNumber: '3312998',
    customQuestions: [{ id: QUESTION_ID, label: 'Willing to run a dedicated lane?', type: 'multipleChoice' }],
    ...over,
});

const application = (over = {}) => ({
    id: 'a1b2c3',
    applicantId: 'a1b2c3',
    companyId: 'company-abc',
    status: 'New',
    confirmationNumber: 'SAF-2024-ABCDE',
    searchFields: { nameLower: 'marcus delgado' },
    submittedAt: '2024-03-02T11:04:00.000Z',
    firstName: 'Marcus',
    lastName: 'Delgado',
    ssn: '412-88-7391',
    street: '812 Cottonwood Lane',
    city: 'Arlington',
    'has-felony': 'no',
    employers: [{ companyName: 'Lone Star Logistics', position: 'OTR Driver', startDate: '2021-01', endDate: '2024-01' }],
    customAnswers: { [QUESTION_ID]: 'Yes' },
    signature: 'data:image/png;base64,AAAA',
    'final-certification': 'yes',
    ...over,
});

const rebuild = (over = {}, companyOver = {}) => reconstructSubmissionSnapshot({
    application: application(over),
    company: company(companyOver),
});

describe('what a reconstruction recovers', () => {
    it('keeps the applicant\'s answers', () => {
        const { snapshot } = rebuild();
        const personal = snapshot.sections.find((s) => s.id === 'personal');
        expect(personal.answers.find((a) => a.fieldId === 'firstName').displayValue).toBe('Marcus');

        const employment = snapshot.sections.find((s) => s.id === 'employment');
        const employers = employment.answers.find((a) => a.fieldId === 'employers');
        expect(employers.rows[0]).toContainEqual({ label: 'Employer', displayValue: 'Lone Star Logistics' });
    });

    it('keeps the submitted date rather than stamping today', () => {
        const { snapshot } = rebuild();
        expect(snapshot.submittedAt).toBe('2024-03-02T11:04:00.000Z');
    });

    it('reads a Firestore Timestamp as well as an ISO string', () => {
        const timestamp = { toDate: () => new Date('2023-05-06T08:00:00.000Z') };
        expect(toIso(timestamp)).toBe('2023-05-06T08:00:00.000Z');
        expect(toIso('2023-05-06')).toBe('2023-05-06T00:00:00.000Z');
        expect(toIso('not a date')).toBeNull();
        expect(toIso(null)).toBeNull();
    });

    it('resolves a custom answer against a question the company still has', () => {
        const { snapshot } = rebuild();
        const answer = snapshot.customAnswers.find((a) => a.questionId === QUESTION_ID);
        expect(answer.label).toBe('Willing to run a dedicated lane?');
        expect(answer.displayValue).toBe('Yes');
    });

    it('keeps the answer to a question the company no longer has, without a label', () => {
        const { snapshot, unrecoverable } = rebuild({
            customAnswers: { 'a-question-since-deleted': 'An orphaned answer' },
        });
        const answer = snapshot.customAnswers.find((a) => a.unknownQuestion);
        expect(answer.displayValue).toBe('An orphaned answer');
        expect(answer.label).toBeNull();
        expect(answer.labelMissing).toBe(true);
        expect(unrecoverable).toContain('custom_question_wording');
    });

    it('excludes metadata from the answers, so an id cannot become one', () => {
        const { snapshot } = rebuild();
        const fieldIds = snapshot.sections.flatMap((s) => s.answers.map((a) => a.fieldId));
        for (const key of ['status', 'confirmationNumber', 'searchFields', 'companyId', 'applicantId']) {
            expect(fieldIds).not.toContain(key);
        }
        expect(answersFrom(application())).not.toHaveProperty('signature');
        expect(answersFrom(application())).not.toHaveProperty('searchFields');
    });
});

describe('what a reconstruction refuses to claim', () => {
    it('is marked reconstructed, always', () => {
        const { snapshot } = rebuild();
        expect(snapshot.provenance.source).toBe('reconstructed');
        expect(snapshot.provenance.notes.length).toBeGreaterThan(1);
    });

    it('says the questions and company details are today\'s, not the day\'s', () => {
        const { snapshot, unrecoverable } = rebuild();
        expect(snapshot.provenance.notes.join(' ')).toMatch(/current settings/i);
        expect(unrecoverable).toContain('definition_at_submission');
    });

    it('attributes agreements to the wording that was ACTUALLY displayed', () => {
        const { snapshot } = rebuild();
        expect(snapshot.agreementVersion).toBe('legacy-1');
        for (const agreement of snapshot.agreements) {
            expect(agreement.version).toBe('legacy-1');
            expect(agreement.legacyWording).toBe(true);
            // The old generator's bug-for-bug substitution, so the text matches
            // what the applicant saw rather than corrected prose.
            expect(agreement.body).toMatch(/Northwind Freight Systems/);
        }
    });

    it('records certification as COMBINED, never as individual acceptance', () => {
        const { snapshot, unrecoverable } = rebuild();
        for (const agreement of snapshot.agreements) {
            expect(agreement.accepted).toBe(true);
            expect(agreement.acceptanceScope).toBe('combined');
        }
        expect(snapshot.provenance.notes.join(' ')).toMatch(/certified the agreements as a set/i);
        expect(unrecoverable).toContain('individual_agreement_acceptance');
    });

    it('claims no acceptance at all when nothing was certified or signed', () => {
        const { snapshot, unrecoverable } = rebuild({ signature: null, 'final-certification': null });
        for (const agreement of snapshot.agreements) {
            expect(agreement.accepted).toBe(false);
            expect(agreement.signature).toBeNull();
            expect(agreement.acceptanceScope).toBeNull();
        }
        expect(snapshot.signature).toBeNull();
        expect(unrecoverable).toContain('agreement_acceptance');
        expect(unrecoverable).toContain('signature');
    });

    it('does not invent a submission date it does not have', () => {
        const { snapshot, unrecoverable } = rebuild({ submittedAt: null, createdAt: null });
        expect(snapshot.provenance.notes.join(' ')).toMatch(/No submission date was recorded/i);
        expect(unrecoverable).toContain('submitted_at');
    });

    it('treats a signature alone as certification, without a certification flag', () => {
        expect(certifiedAt(application({ 'final-certification': null }))).toBe('2024-03-02T11:04:00.000Z');
        expect(certifiedAt(application({ signature: null, 'final-certification': null }))).toBeNull();
        expect(certifiedAt(application({ signature: null, 'final-certification': 'yes' })))
            .toBe('2024-03-02T11:04:00.000Z');
    });
});

describe('a reconstructed record renders', () => {
    it('produces a PDF that says what it is', async () => {
        const { snapshot } = rebuild();
        const { bytes, pageCount } = await renderApplicationPdf({
            snapshot, includeFullSsn: true, generatedAt: '2026-08-07T00:00:00.000Z',
        });
        expect(pageCount).toBeGreaterThan(3);
        expect(bytes.length).toBeGreaterThan(1000);
    });
});
