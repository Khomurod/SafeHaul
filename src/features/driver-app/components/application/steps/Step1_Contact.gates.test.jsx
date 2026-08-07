// Hidden must hide the whole section, not half of it.
//
// When a company set Address History to Hidden, the "Lived at this residence for
// 3 years or more?" question disappeared but the "Previous Addresses (Past 3
// Years)" editor below it did not — heading, Add button and six required fields
// per row all stayed on screen. So a company that had switched the section off
// still saw it, half-present, on its own application.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Step1_Contact from './Step1_Contact';

const companyProfile = { applicationConfig: {} };

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: companyProfile }),
}));

vi.mock('@shared/hooks/useUtils', () => ({
    useUtils: () => ({ states: ['TX', 'CA'] }),
}));

vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showError: vi.fn() }),
}));

const renderStep = ({ applicationConfig = {}, formData = {} } = {}) => {
    companyProfile.applicationConfig = applicationConfig;
    render(
        <form id="driver-form">
            <Step1_Contact
                formData={{ 'known-by-other-name': 'no', ...formData }}
                updateFormData={vi.fn()}
                onNavigate={vi.fn()}
                onPartialSubmit={vi.fn()}
            />
        </form>,
    );
};

const previousAddressesHeading = () => screen.queryByText(/Previous Addresses \(Past 3 Years\)/i);
const threeYearQuestion = () => screen.queryByText(/Lived at this residence for 3 years or more\?/i);

describe('Step 1 — address-history gate', () => {
    it('shows both the three-year question and the previous-address editor by default', () => {
        renderStep();
        expect(threeYearQuestion()).toBeTruthy();
        expect(previousAddressesHeading()).toBeTruthy();
    });

    it('hides the previous-address editor together with the question when hidden', () => {
        renderStep({ applicationConfig: { addressHistory: { hidden: true, required: false } } });
        expect(threeYearQuestion()).toBeNull();
        expect(previousAddressesHeading()).toBeNull();
        expect(screen.queryByRole('button', { name: /Add Previous Address/i })).toBeNull();
    });

    it('honours the legacy `previousAddresses` spelling of the same gate', () => {
        renderStep({ applicationConfig: { previousAddresses: { hidden: true } } });
        expect(previousAddressesHeading()).toBeNull();
    });

    it('keeps the section visible when the company marks it optional', () => {
        renderStep({ applicationConfig: { addressHistory: { hidden: false, required: false } } });
        expect(threeYearQuestion()).toBeTruthy();
        expect(previousAddressesHeading()).toBeTruthy();
    });
});

describe('Step 1 — other configurable fields', () => {
    it('hides SSN and referral source when the company hides them', () => {
        renderStep({
            applicationConfig: {
                ssn: { hidden: true },
                referralSource: { hidden: true },
            },
        });
        expect(screen.queryByLabelText(/Social Security Number/i)).toBeNull();
        expect(screen.queryByLabelText(/How did you hear about us\?/i)).toBeNull();
    });

    it('shows referral source without requiring it when configured optional', () => {
        renderStep({ applicationConfig: { referralSource: { hidden: false, required: false } } });
        const field = screen.getByLabelText(/How did you hear about us\?/i);
        expect(field.required).toBe(false);
    });

    it('requires referral source when the company marks it required', () => {
        renderStep({ applicationConfig: { referralSource: { hidden: false, required: true } } });
        expect(screen.getByLabelText(/How did you hear about us\?/i).required).toBe(true);
    });
});
