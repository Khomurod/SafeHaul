/**
 * The final browser pre-flight: which check runs first, where each one sends
 * the applicant, and what it hands on to the submission when everything holds.
 *
 * The Application Rules verdict itself is pinned by `applicationRules.test.js`
 * (shared vectors, browser and server). This file is about the ROUTING: a
 * resumed draft that never revisited a page still gets walked to the first page
 * whose rule fails, with the sentence that page shows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/components/layout/Stepper', () => ({
    // The semantic step is what is under test; the index it maps to is the
    // Stepper's own contract.
    resolveWizardStepIndex: (semanticStep, hasCustomQuestions) => `${semanticStep}${hasCustomQuestions ? '+custom' : ''}`,
}));

import { runSubmissionPreflight } from './publicApplyPreflight';

const TODAY = new Date();
const LAST_YEAR = `${TODAY.getFullYear() - 1}-01-15`;
const NEXT_YEAR = `${TODAY.getFullYear() + 1}-01-15`;

const HIDDEN = { hidden: true, required: false };

function completeForm(overrides = {}) {
    return {
        firstName: 'Ada', lastName: 'Lovelace',
        email: 'ada@example.com', phone: '5551234567',
        dob: '1990-01-01',
        // Never stored with a draft, so always re-entered before submission.
        ssn: '123-45-6789',
        cdlExpiration: NEXT_YEAR,
        'pre-employment-test-positive': 'no',
        'has-violations': 'no',
        'has-accidents': 'no',
        signature: 'data:image/png;base64,AAA',
        'final-certification': true,
        ...overrides,
    };
}

function run({ formData, company = {}, customQuestions = [], uploads = {} } = {}) {
    const setCurrentStep = vi.fn();
    const showError = vi.fn();
    const result = runSubmissionPreflight({
        formData,
        company,
        customQuestions,
        consentStepIndex: 99,
        cdlUploadConfig: uploads.cdl || HIDDEN,
        medCardConfig: uploads.medCard || HIDDEN,
        mvrConsentConfig: uploads.mvr || HIDDEN,
        setCurrentStep,
        showError,
    });
    return { result, setCurrentStep, showError };
}

describe('runSubmissionPreflight', () => {
    beforeEach(() => vi.clearAllMocks());

    it('passes a complete application and hands on the normalised answers', () => {
        const { result, showError } = run({
            formData: completeForm({ violations: [{ charge: 'left over from before No was chosen' }] }),
        });
        expect(result.ok).toBe(true);
        expect(showError).not.toHaveBeenCalled();
        // An explicit No drops the leftover rows, exactly as the server will.
        expect(result.formData.violations).toEqual([]);
        expect(result.formData['has-violations']).toBe('no');
    });

    // A draft saved before the 49 CFR 40.25(j) question replaced the broader one
    // was never asked it, and one resumed past Qualifications never reaches it.
    it('sends a draft without the 40.25(j) answer back to Qualifications', () => {
        const { result, setCurrentStep, showError } = run({
            formData: completeForm({
                'pre-employment-test-positive': undefined,
                'drug-test-positive': 'yes',
                'drug-test-explanation': 'A refusal in 2015.',
            }),
        });
        expect(result.ok).toBe(false);
        expect(setCurrentStep).toHaveBeenCalledWith('qualifications');
        expect(showError).toHaveBeenCalledWith('Please answer the drug and alcohol testing question on Qualifications to submit.');
    });

    // The Employment page requires the reason for leaving and, for a job of the
    // past three years, the two 49 CFR 391.21(b)(10)(iv) answers. A draft saved
    // before it did, and resumed past that page, never met that requirement.
    describe('what the Employment page requires of each employer', () => {
        const REQUIRED = { employmentHistory: { hidden: false, required: true } };
        const employer = (over = {}) => ({
            companyName: 'Acme Freight', startDate: '2020-01', endDate: `${TODAY.getFullYear()}-01`,
            reasonForLeaving: 'Moved', subjectToFmcsrs: 'yes', subjectToDotTesting: 'no', ...over,
        });
        const UNANSWERED = { reasonForLeaving: '', subjectToFmcsrs: '', subjectToDotTesting: '' };

        it('sends a draft whose employer lacks them back to Employment, naming what is missing', () => {
            const { result, setCurrentStep, showError } = run({
                formData: completeForm({ employers: [employer(), employer(UNANSWERED)] }),
                company: { applicationConfig: REQUIRED },
            });
            expect(result.ok).toBe(false);
            expect(setCurrentStep).toHaveBeenCalledWith('employment');
            expect(showError).toHaveBeenCalledWith(
                'Employer 2: please add the reason for leaving, whether you were subject to the FMCSRs and whether the job was subject to DOT drug and alcohol testing to submit.',
            );
        });

        it('asks only the reason for leaving of a job that ended before the three years', () => {
            const { showError } = run({
                formData: completeForm({ employers: [employer({ ...UNANSWERED, endDate: '2015-06' })] }),
                company: { applicationConfig: REQUIRED },
            });
            expect(showError).toHaveBeenCalledWith('Employer 1: please add the reason for leaving to submit.');
        });

        it('passes an employer with every answer, and leaves them optional where the history is', () => {
            expect(run({ formData: completeForm({ employers: [employer()] }), company: { applicationConfig: REQUIRED } }).result.ok).toBe(true);
            expect(run({
                formData: completeForm({ employers: [employer(UNANSWERED)] }),
                company: { applicationConfig: { employmentHistory: { hidden: false, required: false } } },
            }).result.ok).toBe(true);
        });
    });

    it('walks the applicant to the page whose rule fails, with the page\'s own sentence', () => {
        const { result, setCurrentStep, showError } = run({
            formData: completeForm({ cdlExpiration: LAST_YEAR }),
            company: { applicationRules: { expiredCdl: 'block' } },
        });
        expect(result.ok).toBe(false);
        expect(setCurrentStep).toHaveBeenCalledWith('license');
        expect(showError).toHaveBeenCalledTimes(1);
        expect(showError.mock.calls[0][0]).toMatch(/expir/i);
    });

    it('does not refuse an expired licence the company only warns about', () => {
        const { result } = run({
            formData: completeForm({ cdlExpiration: LAST_YEAR }),
            company: { applicationRules: { expiredCdl: 'warn' } },
        });
        expect(result.ok).toBe(true);
    });

    it('refuses a draft that skipped the Yes/No violations question, and routes to it', () => {
        const { result, setCurrentStep } = run({
            formData: completeForm({ 'has-violations': undefined, violations: [] }),
            company: { applicationRules: { requireViolationDetails: true } },
        });
        expect(result.ok).toBe(false);
        expect(setCurrentStep).toHaveBeenCalledWith('violations');
    });

    it('accounts for the custom-questions page when routing', () => {
        const { setCurrentStep } = run({
            formData: completeForm({ cdlExpiration: LAST_YEAR }),
            company: { applicationRules: { expiredCdl: 'block' } },
            customQuestions: [{ id: 'q1' }],
        });
        expect(setCurrentStep).toHaveBeenCalledWith('license+custom');
    });

    it('re-asks for an answer a resumed draft could not bring back, before anything else', () => {
        const { result, setCurrentStep, showError } = run({
            formData: completeForm({ ssn: '', cdlExpiration: LAST_YEAR }),
            company: { applicationRules: { expiredCdl: 'block' } },
        });
        expect(result.ok).toBe(false);
        expect(setCurrentStep).toHaveBeenCalledWith('contact');
        expect(showError.mock.calls[0][0]).toMatch(/Social Security/);
    });

    it('refuses an impossible date wherever it is, before any other check', () => {
        const { result, setCurrentStep, showError } = run({
            formData: completeForm({ dob: '1990-02-30', signature: '' }),
        });
        expect(result.ok).toBe(false);
        expect(setCurrentStep).toHaveBeenCalledWith('contact');
        expect(showError.mock.calls[0][0]).toMatch(/date/i);
    });

    it('routes a missing required upload to the licence page after the rules hold', () => {
        const { result, setCurrentStep, showError } = run({
            formData: completeForm(),
            uploads: { cdl: { hidden: false, required: true } },
        });
        expect(result.ok).toBe(false);
        expect(setCurrentStep).toHaveBeenCalledWith('license');
        expect(showError.mock.calls[0][0]).toMatch(/CDL Front, CDL Back/);
    });

    it('names the signed MVR authorization form as a document, not as the authorization question', () => {
        const { showError } = run({
            formData: completeForm(),
            uploads: { mvr: { hidden: false, required: true } },
        });
        expect(showError.mock.calls[0][0]).toMatch(/Signed MVR authorization form/);
    });

    it('sends a missing signature to the consent step', () => {
        const { result, setCurrentStep } = run({ formData: completeForm({ signature: '' }) });
        expect(result.ok).toBe(false);
        expect(setCurrentStep).toHaveBeenCalledWith(99);
    });

    // Both used to be refused with a toast and no routing, which left the applicant
    // on the signature page with no idea which page held the field (2026-10-01).
    it('refuses an invalid email or phone and goes to the page that holds them', () => {
        const bad = run({ formData: completeForm({ email: 'nope' }) });
        expect(bad.result.ok).toBe(false);
        expect(bad.setCurrentStep).toHaveBeenCalledWith('contact');
        expect(bad.showError).toHaveBeenCalledWith('Invalid Email Address.');
        const badPhone = run({ formData: completeForm({ phone: '12' }) });
        expect(badPhone.result.ok).toBe(false);
        expect(badPhone.setCurrentStep).toHaveBeenCalledWith('contact');
        expect(badPhone.showError).toHaveBeenCalledWith('Enter a 10-digit US phone number.');
    });
});

describe('employers the carrier locked', () => {
    const acme = { companyName: 'Acme Trucking', dotNumber: '123456' };
    const locked = [{ signature: 'dot:123456', companyName: 'Acme Trucking', dotNumber: '123456' }];

    it('walks the applicant to the employment page when a locked employer went missing', () => {
        const { result, setCurrentStep, showError } = run({
            formData: completeForm({ lockedEmployers: locked, employers: [{ companyName: 'Somewhere Else' }] }),
        });

        expect(result.ok).toBe(false);
        expect(setCurrentStep).toHaveBeenCalledWith('employment');
        expect(showError.mock.calls[0][0]).toContain('Acme Trucking');
    });

    it('refuses a rewritten identity on a locked row', () => {
        const { result, showError } = run({
            formData: completeForm({
                lockedEmployers: locked,
                employers: [{ companyName: 'Not Acme', dotNumber: '123456' }],
            }),
        });

        expect(result.ok).toBe(false);
        expect(showError.mock.calls[0][0]).toMatch(/cannot be changed/);
    });

    it('passes an application that kept them and filled in the rest', () => {
        const { result } = run({
            formData: completeForm({
                lockedEmployers: locked,
                employers: [{
                    ...acme, startDate: '2023-01-01', endDate: '2024-06-30', reasonForLeaving: 'Pay',
                    subjectToFmcsrs: 'yes', subjectToDotTesting: 'yes',
                }],
            }),
        });

        expect(result.ok).toBe(true);
    });

    it('says nothing about an application nobody locked anything on', () => {
        const { result } = run({ formData: completeForm({ employers: [] }) });
        expect(result.ok).toBe(true);
    });
});
