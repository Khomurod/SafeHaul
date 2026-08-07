// Required / Optional / Hidden has to mean what it says.
//
// Emergency Contacts is the one standard question whose settings row offers the
// "visible but optional" transition by default — a company turning the section
// on gets `{ hidden: false, required: false }`. The section hard-coded all four
// Contact #1 inputs as `required`, so that configuration produced an application
// the applicant could not submit: `form.checkValidity()` refused, and nothing on
// screen explained why.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Step7_General from './Step7_General';

const companyProfile = { applicationConfig: {} };

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: companyProfile }),
}));

vi.mock('@shared/hooks/useUtils', () => ({
    useUtils: () => ({ states: ['TX', 'CA'] }),
}));

const renderStep = ({ applicationConfig = {}, formData = {} } = {}) => {
    companyProfile.applicationConfig = applicationConfig;
    render(
        <form id="driver-form">
            <Step7_General
                formData={{ 'has-felony': 'no', ...formData }}
                updateFormData={vi.fn()}
                onNavigate={vi.fn()}
            />
        </form>,
    );
};

const contactOneFields = () => [
    screen.getByLabelText(/Contact #1 Name/i),
    screen.getByLabelText(/Contact #1 Phone/i),
    screen.getByLabelText(/Contact #1 Relationship/i),
    screen.getByLabelText(/Contact #1 Address/i),
];

describe('Step 7 — emergency-contacts gate', () => {
    it('hides the section by default, preserving the historical default', () => {
        renderStep();
        expect(screen.queryByText(/Emergency Contacts/i)).toBeNull();
    });

    it('hides the section when the company hides it explicitly', () => {
        renderStep({ applicationConfig: { emergencyContacts: { hidden: true, required: false } } });
        expect(screen.queryByText(/Emergency Contacts/i)).toBeNull();
    });

    it('shows Contact #1 WITHOUT requiring it when the section is visible but optional', () => {
        renderStep({ applicationConfig: { emergencyContacts: { hidden: false, required: false } } });
        for (const field of contactOneFields()) {
            expect(field.required).toBe(false);
        }
    });

    it('requires Contact #1 when the company marks the section required', () => {
        renderStep({ applicationConfig: { emergencyContacts: { hidden: false, required: true } } });
        for (const field of contactOneFields()) {
            expect(field.required).toBe(true);
        }
    });

    it('never requires Contact #2, in any configuration', () => {
        renderStep({ applicationConfig: { emergencyContacts: { hidden: false, required: true } } });
        expect(screen.getByLabelText(/Contact #2 Name/i).required).toBe(false);
        expect(screen.getByLabelText(/Contact #2 Phone/i).required).toBe(false);
    });

    it('honours the legacy `showEmergencyContacts` boolean, which carries no requiredness', () => {
        // `true` means visible; requiredness falls back to the gate default,
        // which for emergency contacts is not-required.
        renderStep({ applicationConfig: { showEmergencyContacts: true } });
        for (const field of contactOneFields()) {
            expect(field.required).toBe(false);
        }
    });

    it('labels the optional configuration as optional on screen', () => {
        renderStep({ applicationConfig: { emergencyContacts: { hidden: false, required: false } } });
        expect(screen.getByText(/Contact #1 \(Optional\)/i)).toBeTruthy();
    });
});
