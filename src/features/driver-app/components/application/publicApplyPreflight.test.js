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

    it('refuses an invalid email or phone without moving the applicant', () => {
        const bad = run({ formData: completeForm({ email: 'nope' }) });
        expect(bad.result.ok).toBe(false);
        expect(bad.setCurrentStep).not.toHaveBeenCalled();
        const badPhone = run({ formData: completeForm({ phone: '12' }) });
        expect(badPhone.result.ok).toBe(false);
    });
});
