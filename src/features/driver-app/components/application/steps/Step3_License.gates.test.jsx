// Company settings must actually change the driver's application.
//
// `mvrConsent` was configurable in Settings → Questions for as long as that
// screen existed, but no step rendered the field and no validator enforced it,
// so the toggle changed nothing at all. These tests pin the gate to real,
// observable behaviour: hidden by default, shown when the company asks for it,
// blocking only when the company marks it Required.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Step3_License from './Step3_License';

const companyProfile = { applicationConfig: {} };

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: companyProfile }),
}));

vi.mock('@shared/hooks/useUtils', () => ({
    useUtils: () => ({ states: ['TX', 'CA'] }),
}));

const baseFormData = {
    cdlState: 'TX',
    cdlClass: 'Class A',
    cdlNumber: 'D1234567',
    cdlExpiration: '2030-01-01',
    'has-twic': 'no',
    'cdl-front': 'front.jpg',
    'cdl-back': 'back.jpg',
    'medical-card-upload': 'med.jpg',
};

const renderStep = ({ applicationConfig = {}, formData = {}, onNavigate = vi.fn() } = {}) => {
    companyProfile.applicationConfig = applicationConfig;
    render(
        <form id="driver-form">
            <Step3_License
                formData={{ ...baseFormData, ...formData }}
                updateFormData={vi.fn()}
                handleFileUpload={vi.fn()}
                onNavigate={onNavigate}
                isUploading={false}
            />
        </form>
    );
    const formEl = document.getElementById('driver-form');
    formEl.checkValidity = vi.fn(() => true);
    formEl.reportValidity = vi.fn();
    return { onNavigate };
};

const continueButton = () => screen.getByRole('button', { name: /continue/i });

describe('Step3_License — MVR consent gate', () => {
    beforeEach(() => {
        companyProfile.applicationConfig = {};
    });

    it('is not shown to a driver when the company has not asked for it', () => {
        renderStep();
        expect(screen.queryAllByText(/Upload MVR Consent Form/i)).toHaveLength(0);
    });

    it('is shown when the company enables it', () => {
        renderStep({ applicationConfig: { mvrConsent: { hidden: false, required: false } } });
        expect(screen.queryAllByText(/Upload MVR Consent Form/i).length).toBeGreaterThan(0);
    });

    it('does not block Continue when the company marked it optional', () => {
        const { onNavigate } = renderStep({
            applicationConfig: { mvrConsent: { hidden: false, required: false } },
        });
        fireEvent.click(continueButton());
        expect(onNavigate).toHaveBeenCalledWith('next');
    });

    it('blocks Continue with a named error when the company marked it required', () => {
        const { onNavigate } = renderStep({
            applicationConfig: { mvrConsent: { hidden: false, required: true } },
        });
        fireEvent.click(continueButton());
        expect(onNavigate).not.toHaveBeenCalled();
        expect(screen.getByText(/Please upload required documents: MVR Consent Form\./))
            .toBeInTheDocument();
    });

    it('lets a driver through once the required form is uploaded', () => {
        const { onNavigate } = renderStep({
            applicationConfig: { mvrConsent: { hidden: false, required: true } },
            formData: { 'mvr-consent-upload': 'consent.pdf' },
        });
        fireEvent.click(continueButton());
        expect(onNavigate).toHaveBeenCalledWith('next');
    });
});

describe('Step3_License — CDL and medical-card gates', () => {
    beforeEach(() => {
        companyProfile.applicationConfig = {};
    });

    it('hides the CDL uploads entirely when the company hides them', () => {
        renderStep({ applicationConfig: { cdlUpload: { hidden: true } } });
        expect(screen.queryByText(/Upload CDL \(Front\)/i)).not.toBeInTheDocument();
    });

    it('does not require a hidden gate, even if the stored value says required', () => {
        // hidden + required is contradictory; the resolver drops `required`, so a
        // driver can never be blocked by a question they were never shown.
        const { onNavigate } = renderStep({
            applicationConfig: { medCardUpload: { hidden: true, required: true } },
            formData: { 'medical-card-upload': '' },
        });
        fireEvent.click(continueButton());
        expect(onNavigate).toHaveBeenCalledWith('next');
    });

    it('honours the medical-card requirement the application has always enforced', () => {
        const { onNavigate } = renderStep({ formData: { 'medical-card-upload': '' } });
        fireEvent.click(continueButton());
        expect(onNavigate).not.toHaveBeenCalled();
    });
});
