/**
 * A disclosure answered Yes needs its explanation before the driver moves on.
 *
 * The three driving-record boxes were natively `required`, which a box holding
 * only spaces satisfies; the positive pre-employment test's box was not
 * required at all, so an empty one went through. Both pages now ask the rules
 * engine in strict mode (`useStepGate`), which treats a blank or spaces-only
 * explanation as missing and names the page's own sentence.
 *
 * The real step gate runs here: only the company profile and the agreement
 * wording are stood in for.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Step2_Qualifications from './Step2_Qualifications';
import Step4_Violations from './Step4_Violations';

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'co-1' } }),
}));

vi.mock('@features/driver-app/hooks/useApplicationAgreements', () => ({
    useApplicationAgreements: () => ({ agreements: [], loading: false, error: null, retry: vi.fn() }),
}));

function renderStep(Step, initial) {
    const onNavigate = vi.fn();
    function Harness() {
        const [formData, setFormData] = useState(initial);
        const updateFormData = (name, value) => setFormData((prev) => ({ ...prev, [name]: value }));
        return (
            <form id="driver-form">
                <Step formData={formData} updateFormData={updateFormData} onNavigate={onNavigate} onPartialSubmit={vi.fn()} />
            </form>
        );
    }
    render(<Harness />);
    return { onNavigate };
}

const QUALIFIED = {
    'legal-work': 'yes', 'english-fluency': 'yes', 'dot-return-to-duty': 'yes', 'experience-years': '1',
};
const CLEAN_RECORD = {
    'consent-mvr': 'no', 'revoked-licenses': 'no', 'driving-convictions': 'no', 'drug-alcohol-convictions': 'no', 'has-violations': 'no',
};

const continueOn = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

describe('Qualifications: the positive pre-employment test', () => {
    it('marks the explanation required', () => {
        renderStep(Step2_Qualifications, { ...QUALIFIED, 'pre-employment-test-positive': 'yes' });
        expect(document.querySelector('[name="pre-employment-test-explanation"]')).toBeRequired();
    });

    it.each([['empty', ''], ['only spaces', '   ']])('does not move on with the explanation %s', (_name, text) => {
        const { onNavigate } = renderStep(Step2_Qualifications, {
            ...QUALIFIED, 'pre-employment-test-positive': 'yes', 'pre-employment-test-explanation': text,
        });
        continueOn();
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('moves on once it is explained', () => {
        const { onNavigate } = renderStep(Step2_Qualifications, {
            ...QUALIFIED, 'pre-employment-test-positive': 'yes', 'pre-employment-test-explanation': 'Refused in 2025, SAP completed',
        });
        continueOn();
        expect(onNavigate).toHaveBeenCalledWith('next');
    });
});

describe('Motor Vehicle Record: the three disclosures', () => {
    it.each([
        ['revoked-licenses', 'revocationExplanation', 'Please explain the license denial, suspension or revocation you reported.'],
        ['driving-convictions', 'convictionExplanation', 'Please explain the conviction or pending charge for driving without a valid license that you reported.'],
        ['drug-alcohol-convictions', 'drugConvictionExplanation', 'Please explain the alcohol or controlled substance offense you reported.'],
    ])('%s Yes with an explanation of only spaces stays, and says why', (flag, field, sentence) => {
        const { onNavigate } = renderStep(Step4_Violations, { ...CLEAN_RECORD, [flag]: 'yes', [field]: '    ' });
        continueOn();
        expect(onNavigate).not.toHaveBeenCalled();
        expect(screen.getByText(sentence)).toBeInTheDocument();
    });

    it('moves on once each Yes is explained', () => {
        const { onNavigate } = renderStep(Step4_Violations, {
            ...CLEAN_RECORD, 'revoked-licenses': 'yes', revocationExplanation: 'Suspended 2019, reinstated 2020',
        });
        continueOn();
        expect(onNavigate).toHaveBeenCalledWith('next');
    });
});
