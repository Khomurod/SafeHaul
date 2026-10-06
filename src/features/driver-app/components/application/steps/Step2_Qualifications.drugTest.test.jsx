// The drug and alcohol question is the one 49 CFR 40.25(j) requires, in its own
// terms: pre-employment tests, in the past two years. It used to ask "ever", and
// about any DOT test. Its answer has its own key, because the Production
// frontend asks the broader question until it is promoted and the shared
// backend records each under its own label.
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Step2_Qualifications from './Step2_Qualifications';

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { applicationConfig: {} } }),
}));

const QUESTION = /Positive pre-employment test or refusal in the past two years/;

function renderStep(formData = {}) {
    const updateFormData = vi.fn();
    render(
        <form id="driver-form">
            <Step2_Qualifications formData={formData} updateFormData={updateFormData} onNavigate={vi.fn()} onPartialSubmit={vi.fn()} />
        </form>,
    );
    return { updateFormData, group: screen.getByRole('group', { name: QUESTION }) };
}

describe('Step 2 — the 40.25(j) question', () => {
    it('asks about pre-employment tests in the past two years, not "ever"', () => {
        renderStep();
        expect(screen.getByText(
            'In the past two years, have you tested positive, or refused to test, on any pre-employment drug or alcohol test administered by an employer to which you applied for, but did not obtain, safety-sensitive transportation work covered by DOT agency drug and alcohol testing rules?',
        )).toBeInTheDocument();
        expect(screen.queryByText(/have you ever/i)).not.toBeInTheDocument();
    });

    it('saves the answer under its own key', () => {
        const { updateFormData, group } = renderStep();
        fireEvent.click(within(group).getByRole('radio', { name: 'No' }));
        expect(updateFormData).toHaveBeenCalledWith('pre-employment-test-positive', 'no');
        expect(updateFormData).not.toHaveBeenCalledWith('drug-test-positive', expect.anything());
    });

    it('does not offer a draft\'s answer to the broader question as the answer to this one', () => {
        const { group } = renderStep({ 'drug-test-positive': 'yes', 'drug-test-explanation': 'A refusal in 2015.' });
        for (const radio of within(group).getAllByRole('radio')) expect(radio).not.toBeChecked();
        expect(screen.queryByDisplayValue('A refusal in 2015.')).not.toBeInTheDocument();
    });

    it('clears a draft\'s answer to the broader question once this one is answered', () => {
        const { updateFormData, group } = renderStep({ 'drug-test-positive': 'yes', 'drug-test-explanation': 'A refusal in 2015.' });
        fireEvent.click(within(group).getByRole('radio', { name: 'No' }));
        expect(updateFormData).toHaveBeenCalledWith('pre-employment-test-positive', 'no');
        expect(updateFormData).toHaveBeenCalledWith('drug-test-positive', '');
        expect(updateFormData).toHaveBeenCalledWith('drug-test-explanation', '');
    });

    it('asks for an explanation of a Yes under its own key', () => {
        renderStep({ 'pre-employment-test-positive': 'yes' });
        const explanation = screen.getByLabelText('Please explain:');
        expect(explanation).toHaveAttribute('name', 'pre-employment-test-explanation');
    });
});
