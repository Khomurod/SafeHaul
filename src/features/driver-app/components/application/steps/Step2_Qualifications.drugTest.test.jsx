// The drug and alcohol question is the one 49 CFR 40.25(j) requires, in its own
// terms: pre-employment tests, in the past two years. It used to ask "ever", and
// about any DOT test.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Step2_Qualifications from './Step2_Qualifications';

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { applicationConfig: {} } }),
}));

describe('Step 2 — the 40.25(j) question', () => {
    it('asks about pre-employment tests in the past two years, not "ever"', () => {
        render(
            <form id="driver-form">
                <Step2_Qualifications formData={{}} updateFormData={vi.fn()} onNavigate={vi.fn()} onPartialSubmit={vi.fn()} />
            </form>,
        );
        expect(screen.getByText(
            'In the past two years, have you tested positive, or refused to test, on any pre-employment drug or alcohol test administered by an employer to which you applied for, but did not obtain, safety-sensitive transportation work covered by DOT agency drug and alcohol testing rules?',
        )).toBeInTheDocument();
        expect(screen.queryByText(/have you ever/i)).not.toBeInTheDocument();
        expect(screen.getByRole('group', { name: /Positive pre-employment test or refusal in the past two years/ })).toBeInTheDocument();
    });
});
