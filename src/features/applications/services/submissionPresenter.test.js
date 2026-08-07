import { describe, expect, it } from 'vitest';
import {
    NOT_PROVIDED,
    WORDING_UNAVAILABLE,
    describeAgreementEvidence,
    describeEmploymentCoverage,
    isPreservedSnapshot,
    isReconstructed,
    presentSubmission,
    toDisplayAgreements,
    toDisplayAnswer,
    toDisplayCustomAnswers,
    toDisplaySections,
} from './submissionPresenter';

// Artificial applicants, companies and questions only.
const snapshot = (over = {}) => ({
    schemaVersion: 1,
    frozen: true,
    definitionVersion: 'def-abc',
    agreementVersion: 'v1',
    submittedAt: '2026-06-15T12:00:00.000Z',
    company: { companyName: 'Artificial Freight Co', dotNumber: '1234567' },
    sections: [
        {
            id: 'personal',
            title: 'Personal Information',
            answers: [
                { fieldId: 'firstName', label: 'First Name', displayValue: 'Ann', presented: true },
                { fieldId: 'middleName', label: 'Middle Name', displayValue: null, presented: true },
            ],
        },
    ],
    customAnswers: [],
    agreements: [],
    employmentCoverage: null,
    provenance: { source: 'submission', notes: [] },
    ...over,
});

const agreement = (over = {}) => ({
    id: 'clearinghouseConsent',
    version: 'v1',
    title: 'FMCSA CLEARINGHOUSE FULL QUERY CONSENT',
    body: 'I hereby provide consent to Artificial Freight Co ...',
    legacyWording: false,
    requiresSignature: true,
    accepted: true,
    acceptedAt: '2026-06-15T12:00:03.000Z',
    evidenceRecorded: true,
    signature: { type: 'drawn', capturedAt: '2026-06-15T12:00:00.000Z', present: true },
    ...over,
});

describe('recognising a preserved record', () => {
    it('accepts a frozen snapshot with sections', () => {
        expect(isPreservedSnapshot(snapshot())).toBe(true);
    });

    it.each([null, undefined, {}, { frozen: false, sections: [] }, { frozen: true }])(
        'rejects %p as not a preserved record', (value) => {
            expect(isPreservedSnapshot(value)).toBe(false);
        });

    it('identifies a reconstructed record', () => {
        expect(isReconstructed(snapshot({ provenance: { source: 'reconstructed' } }))).toBe(true);
        expect(isReconstructed(snapshot())).toBe(false);
    });
});

describe('standard answers', () => {
    it('shows the recorded wording and value', () => {
        const row = toDisplayAnswer({ fieldId: 'firstName', label: 'First Name', displayValue: 'Ann', presented: true });
        expect(row.label).toBe('First Name');
        expect(row.value).toBe('Ann');
        expect(row.isMissing).toBe(false);
    });

    it('says "Not provided" for an empty answer instead of inventing one', () => {
        const row = toDisplayAnswer({ fieldId: 'middleName', label: 'Middle Name', displayValue: null, presented: true });
        expect(row.value).toBe(NOT_PROVIDED);
        expect(row.isMissing).toBe(true);
    });

    // A question the driver never saw must not appear as one they failed to answer.
    it('drops a field that was never presented', () => {
        expect(toDisplayAnswer({ fieldId: 'felonyExplanation', label: 'Felony Explanation', presented: false })).toBeNull();
    });

    it('keeps the sensitive flag so the SSN policy can be applied downstream', () => {
        const row = toDisplayAnswer({ fieldId: 'ssn', label: 'Social Security Number', displayValue: '123-45-6789', presented: true, sensitive: true });
        expect(row.sensitive).toBe(true);
    });

    it('flags a repeating group so a generic renderer cannot print an object', () => {
        const row = toDisplayAnswer({
            fieldId: 'employers', label: 'Employment History', presented: true,
            repeating: true, value: [{ companyName: 'Prior Carrier' }],
        });
        expect(row.repeating).toBe(true);
        expect(row.rawValue).toEqual([{ companyName: 'Prior Carrier' }]);
    });

    it('drops sections that end up empty rather than showing a bare heading', () => {
        const sections = toDisplaySections(snapshot({
            sections: [
                { id: 'personal', title: 'Personal Information', answers: [{ fieldId: 'firstName', label: 'First Name', displayValue: 'Ann', presented: true }] },
                { id: 'documents', title: 'Required Documents', answers: [{ fieldId: 'x', label: 'X', presented: false }] },
            ],
        }));
        expect(sections.map((s) => s.id)).toEqual(['personal']);
    });

    it('returns nothing when there is no preserved record', () => {
        expect(toDisplaySections(null)).toEqual([]);
    });
});

describe('no internal identifier is ever user-visible', () => {
    // THE DEFECT: the PDF used the question id as its label, so UUIDs were shown.
    it('describes an unrecorded question wording instead of printing its id', () => {
        const rows = toDisplayCustomAnswers(snapshot({
            customAnswers: [{
                questionId: '8f14e45f-ea0a-4c1b-9f2d-000000000000',
                label: null, labelMissing: true, displayValue: 'Yes', unknownQuestion: false,
            }],
        }));
        expect(rows[0].label).toBe(WORDING_UNAVAILABLE);
        expect(rows[0].label).not.toContain('8f14e45f');
        expect(rows[0].labelUnavailable).toBe(true);
        // The driver's answer is still shown.
        expect(rows[0].value).toBe('Yes');
    });

    it('keeps an orphaned answer but marks it unmatched', () => {
        const rows = toDisplayCustomAnswers(snapshot({
            customAnswers: [{ questionId: 'deleted-uuid', label: null, labelMissing: true, unknownQuestion: true, displayValue: 'Some answer' }],
        }));
        expect(rows[0].unmatched).toBe(true);
        expect(rows[0].value).toBe('Some answer');
    });

    it('never renders the id anywhere in a presented row', () => {
        const id = 'b3d1c7aa-1111-2222-3333-444455556666';
        const [row] = toDisplayCustomAnswers(snapshot({
            customAnswers: [{ questionId: id, label: null, labelMissing: true, displayValue: 'Yes' }],
        }));
        // `key` is a React concern; every *textual* field must be free of the id.
        expect(row.label).not.toContain(id);
        expect(row.value).not.toContain(id);
    });

    it('uses the recorded wording when it exists', () => {
        const [row] = toDisplayCustomAnswers(snapshot({
            customAnswers: [{ questionId: 'q1', label: 'Preferred route type?', labelMissing: false, displayValue: 'OTR' }],
        }));
        expect(row.label).toBe('Preferred route type?');
        expect(row.labelUnavailable).toBe(false);
    });

    it('gives an unanswered custom question the same honest placeholder', () => {
        const [row] = toDisplayCustomAnswers(snapshot({
            customAnswers: [{ questionId: 'q1', label: 'Any restrictions?', labelMissing: false, displayValue: null }],
        }));
        expect(row.value).toBe(NOT_PROVIDED);
    });
});

describe('agreement evidence distinguishes accepted, declined and unrecorded', () => {
    it('describes an accepted agreement with its signature', () => {
        const row = describeAgreementEvidence(agreement());
        expect(row.status).toBe('accepted');
        expect(row.summary).toBe('Accepted and signed by the applicant');
        expect(row.hasSignature).toBe(true);
        expect(row.acceptedAt).toBe('2026-06-15T12:00:03.000Z');
    });

    // THE DEFECT: the old PDF stamped a signature block onto all four agreements
    // regardless of whether each was presented or accepted.
    it('never reports a signature where acceptance was not recorded', () => {
        const row = describeAgreementEvidence(agreement({
            accepted: false, evidenceRecorded: false, acceptedAt: null, signature: null,
        }));
        expect(row.status).toBe('unrecorded');
        expect(row.summary).toBe('No acceptance was recorded for this agreement');
        expect(row.hasSignature).toBe(false);
        // The wording presented is still available for review.
        expect(row.body).toContain('Artificial Freight Co');
    });

    it('states a recorded refusal plainly, because it is legally meaningful', () => {
        const row = describeAgreementEvidence(agreement({ accepted: false, evidenceRecorded: true, signature: null }));
        expect(row.status).toBe('declined');
        expect(row.summary).toBe('The applicant did not accept this agreement');
        expect(row.hasSignature).toBe(false);
    });

    it('reports no signature when none was captured, even if accepted', () => {
        expect(describeAgreementEvidence(agreement({ signature: null })).hasSignature).toBe(false);
        expect(describeAgreementEvidence(agreement({ signature: { present: false } })).hasSignature).toBe(false);
    });

    it('marks legacy wording so a reconstructed record can be labelled', () => {
        expect(describeAgreementEvidence(agreement({ legacyWording: true })).legacyWording).toBe(true);
    });

    it('surfaces the Clearinghouse consent like any other agreement', () => {
        const rows = toDisplayAgreements(snapshotWithAgreements());
        expect(rows.map((r) => r.key)).toContain('clearinghouseConsent');
    });

    function snapshotWithAgreements() {
        return snapshot({ agreements: [agreement()] });
    }
});

describe('employment coverage summary', () => {
    it('states a complete history', () => {
        const c = describeEmploymentCoverage(snapshot({
            employmentCoverage: { requiredMonths: 36, coveredMonths: 36, missingMonths: 0, isComplete: true, gaps: [] },
        }));
        expect(c.isComplete).toBe(true);
        expect(c.summary).toBe('Accounts for the required 3 years of history.');
    });

    it('quantifies an incomplete history rather than just flagging it', () => {
        const c = describeEmploymentCoverage(snapshot({
            employmentCoverage: {
                requiredMonths: 36, coveredMonths: 18, missingMonths: 18, isComplete: false,
                gaps: [{ fromMonth: '2023-07', toMonth: '2024-12', months: 18 }],
            },
        }));
        expect(c.summary).toBe('Accounts for 18 of 36 months; 18 unaccounted for.');
        expect(c.gaps).toHaveLength(1);
    });

    it('returns null when coverage was never computed', () => {
        expect(describeEmploymentCoverage(snapshot())).toBeNull();
        expect(describeEmploymentCoverage(null)).toBeNull();
    });
});

describe('presentSubmission', () => {
    it('presents a live submission with no notice', () => {
        const view = presentSubmission(snapshot());
        expect(view.isPreserved).toBe(true);
        expect(view.isReconstructed).toBe(false);
        expect(view.notice).toBeNull();
        expect(view.company.companyName).toBe('Artificial Freight Co');
        expect(view.submittedAt).toBe('2026-06-15T12:00:00.000Z');
    });

    // Callers must not pass live data off as the submitted original.
    it('says plainly when no preserved record exists', () => {
        const view = presentSubmission(null);
        expect(view.isPreserved).toBe(false);
        expect(view.notice).toContain('No preserved submission record');
        expect(view.sections).toEqual([]);
        expect(view.agreements).toEqual([]);
    });

    it('warns that a reconstructed record lacks individual acceptance evidence', () => {
        const view = presentSubmission(snapshot({
            provenance: { source: 'reconstructed', notes: ['Acceptance not captured at submission.'] },
        }));
        expect(view.isReconstructed).toBe(true);
        expect(view.notice).toContain('individual acceptance');
        expect(view.reconstructionNotes).toEqual(['Acceptance not captured at submission.']);
    });
});

describe('a snapshot written before columns existed', () => {
    // Between the first snapshot release and columns being declared, repeating
    // records were stored as raw objects with no resolved rows. Showing only
    // `rows` said "None recorded" for an applicant who listed three employers.
    const legacyAnswer = {
        fieldId: 'employers',
        label: 'Previous Employers',
        presented: true,
        repeating: true,
        rows: null,
        value: [{ companyName: 'Lone Star Logistics', position: 'OTR Driver', mayContact: 'yes' }],
    };

    it('lays the records out rather than dropping them', () => {
        const row = toDisplayAnswer(legacyAnswer);
        expect(row.rows).toHaveLength(1);
        expect(row.rows[0]).toContainEqual({ label: 'Employer', displayValue: 'Lone Star Logistics' });
        expect(row.usedCurrentColumns).toBe(true);
    });

    it('reads only declared columns, so a stored internal key cannot leak', () => {
        const row = toDisplayAnswer({
            ...legacyAnswer,
            value: [{ companyName: 'Acme', _localDraftId: 'draft-7712-internal' }],
        });
        expect(JSON.stringify(row.rows)).not.toMatch(/draft-7712-internal/);
    });

    it('does not claim current columns when the record already has its own rows', () => {
        const row = toDisplayAnswer({
            ...legacyAnswer,
            rows: [[{ label: 'Employer', displayValue: 'Frozen Freight' }]],
        });
        expect(row.usedCurrentColumns).toBe(false);
        expect(row.rows[0][0].displayValue).toBe('Frozen Freight');
    });

    it('still reports an empty group as empty', () => {
        const row = toDisplayAnswer({ ...legacyAnswer, rows: null, value: [] });
        expect(row.rows).toEqual([]);
        expect(row.usedCurrentColumns).toBe(false);
    });
});
