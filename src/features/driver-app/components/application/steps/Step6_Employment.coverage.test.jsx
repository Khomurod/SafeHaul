// The three-year employment-coverage prompt.
//
// The requirement is deliberately two-sided and both sides are load-bearing:
// a driver with an incomplete history must be *told*, and must *always* still be
// able to continue. A test that only checked the encouragement would let a
// future change turn it into a hard block without failing.

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Step6_Employment from './Step6_Employment';

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { applicationConfig: {} } }),
}));
vi.mock('@shared/hooks/useUtils', () => ({
    useUtils: () => ({ states: ['TX', 'CA'] }),
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

const NOW = new Date('2026-06-15T00:00:00Z');

// A single job covering the whole three-year window.
const completeHistory = {
    employers: [{
        companyName: 'Artificial Freight Co',
        address: '1 Test Way', city: 'Springfield', state: 'TX',
        phone: '5555550100',
        startDate: '2020-01-01', endDate: '',
    }],
};

// Eighteen months covered, eighteen missing.
const partialHistory = {
    employers: [{
        companyName: 'Artificial Freight Co',
        address: '1 Test Way', city: 'Springfield', state: 'TX',
        phone: '5555550100',
        startDate: '2025-01-01', endDate: '',
    }],
};

const renderStep = ({ formData = {}, onNavigate = vi.fn() } = {}) => {
    render(
        <form id="driver-form">
            <Step6_Employment
                formData={formData}
                updateFormData={vi.fn()}
                onNavigate={onNavigate}
            />
        </form>
    );
    const form = document.getElementById('driver-form');
    form.checkValidity = vi.fn(() => true);
    form.reportValidity = vi.fn();
    return { onNavigate };
};

const clickContinue = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

describe('Step6_Employment — three-year coverage', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(NOW);
        // jsdom/happy-dom do not implement scrollIntoView.
        Element.prototype.scrollIntoView = vi.fn();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('states how much of the three years is accounted for', () => {
        renderStep({ formData: partialHistory });
        expect(screen.getByText(/18 of 36 months/)).toBeInTheDocument();
    });

    it('confirms a complete history rather than staying silent', () => {
        renderStep({ formData: completeHistory });
        expect(screen.getByText(/accounts for all 36 months/)).toBeInTheDocument();
    });

    it('continues straight through when the three years are covered', () => {
        const { onNavigate } = renderStep({ formData: completeHistory });
        clickContinue();
        expect(onNavigate).toHaveBeenCalledWith('next');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('interrupts Continue once when months are unexplained', () => {
        const { onNavigate } = renderStep({ formData: partialHistory });
        clickContinue();
        expect(onNavigate).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('names the exact months that are missing', () => {
        renderStep({ formData: partialHistory });
        clickContinue();
        const alert = within(screen.getByRole('alert'));
        expect(alert.getByText(/July 2023 – December 2024/)).toBeInTheDocument();
        expect(alert.getAllByText(/18 months/).length).toBeGreaterThan(0);
    });

    it('lists every kind of period that counts', () => {
        renderStep({ formData: partialHistory });
        clickContinue();
        const alert = within(screen.getByRole('alert'));
        expect(alert.getByText(/A job you held/)).toBeInTheDocument();
        expect(alert.getByText(/unemployed or between jobs/)).toBeInTheDocument();
        expect(alert.getByText(/Driving school/)).toBeInTheDocument();
        expect(alert.getByText(/Military service/)).toBeInTheDocument();
    });

    it('always lets the driver continue anyway', () => {
        const { onNavigate } = renderStep({ formData: partialHistory });
        clickContinue();
        fireEvent.click(screen.getByRole('button', { name: 'Continue anyway' }));
        expect(onNavigate).toHaveBeenCalledWith('next');
    });

    it('keeps Continue anyway the quieter of the two actions', () => {
        renderStep({ formData: partialHistory });
        clickContinue();
        const alert = within(screen.getByRole('alert'));
        expect(alert.getByRole('button', { name: 'Add missing history' }))
            .toHaveAttribute('data-variant', 'primary');
        expect(alert.getByRole('button', { name: 'Continue anyway' }))
            .toHaveAttribute('data-variant', 'ghost');
    });

    it('does not trap the driver: a second Continue proceeds', () => {
        const { onNavigate } = renderStep({ formData: partialHistory });
        clickContinue();
        expect(onNavigate).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Add missing history' }));
        clickContinue();
        expect(onNavigate).toHaveBeenCalledWith('next');
    });

    it('moves focus to the prompt so it is not missed by keyboard users', () => {
        renderStep({ formData: partialHistory });
        clickContinue();
        expect(document.activeElement).toBe(
            screen.getByRole('heading', { level: 3, name: /not accounted for/ })
        );
    });

    it('counts an explained gap the driver entered under the wizard key', () => {
        // `unemployment` is the key DynamicRow writes. Coverage used to read only
        // `unemploymentPeriods`, so this driver was told their explained gap did
        // not exist.
        const { onNavigate } = renderStep({
            formData: {
                ...partialHistory,
                unemployment: [{ startDate: '2023-07-01', endDate: '2024-12-31' }],
            },
        });
        expect(screen.getByText(/accounts for all 36 months/)).toBeInTheDocument();
        clickContinue();
        expect(onNavigate).toHaveBeenCalledWith('next');
    });

    it('counts driving school and military service', () => {
        renderStep({
            formData: {
                schools: [{ name: 'Test CDL School', startDate: '2023-07-01', endDate: '2024-12-31' }],
                military: [{ branch: 'Army', start: '2025-01', end: '2026-06' }],
            },
        });
        expect(screen.getByText(/accounts for all 36 months/)).toBeInTheDocument();
    });

    it('says so when an entry has no usable dates instead of silently ignoring it', () => {
        renderStep({
            formData: {
                employers: [{
                    companyName: 'Artificial Freight Co',
                    phone: '5555550100',
                    startDate: '', endDate: '',
                }],
            },
        });
        clickContinue();
        expect(within(screen.getByRole('alert')).getByText(/missing usable start or end dates/))
            .toBeInTheDocument();
    });
});
