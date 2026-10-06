// The Employment page asks what 49 CFR 391.21(b)(10)-(11) asks: every employer
// of the past three years, the CDL employers of the seven years before, the
// reason for leaving, and the two (b)(10)(iv) questions about each employer of
// the three years, with nothing pre-selected.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Step6_Employment from './Step6_Employment';

const company = vi.hoisted(() => ({ profile: null }));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: company.profile }),
}));
vi.mock('@shared/hooks/useUtils', () => ({
    useUtils: () => ({ states: ['TX', 'CA'] }),
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

const NOW = new Date('2026-10-06T12:00:00Z');

const employer = (overrides = {}) => ({
    companyName: 'Artificial Freight Co',
    address: '1 Test Way', city: 'Springfield', state: 'TX',
    phone: '5555550100',
    startDate: '2024-01-01', endDate: '',
    reasonForLeaving: '', subjectToFmcsrs: '', subjectToDotTesting: '',
    ...overrides,
});

const renderStep = (formData) => {
    const updateFormData = vi.fn();
    render(
        <form id="driver-form">
            <Step6_Employment formData={formData} updateFormData={updateFormData} onNavigate={vi.fn()} />
        </form>
    );
    return { updateFormData };
};

const fmcsrsQuestion = /subject to the FMCSRs/;
const dotTestingQuestion = /safety-sensitive function/;

describe('Step6_Employment — what 49 CFR 391.21 asks', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(NOW);
        company.profile = { applicationConfig: {} };
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('asks for every employer of three years, and the CDL employers of the seven before', () => {
        renderStep({ employers: [] });

        expect(screen.getByText(/list every employer, driving or not/)).toBeInTheDocument();
        expect(screen.getByText(/also list each employer you drove a commercial motor vehicle for/)).toBeInTheDocument();
        expect(screen.queryByText(/past 10 years/)).not.toBeInTheDocument();
        expect(screen.queryByText(/This company asks/)).not.toBeInTheDocument();
    });

    it('says so when the company asks for more years than the law', () => {
        company.profile = { applicationConfig: {}, applicationRules: { employmentHistoryMinimumYears: 5 } };
        renderStep({ employers: [] });

        expect(screen.getByText('This company asks you to account for the past 5 years.')).toBeInTheDocument();
    });

    it('asks both questions about a current job, with neither answer chosen, and requires them', () => {
        renderStep({ employers: [employer()] });

        for (const question of [fmcsrsQuestion, dotTestingQuestion]) {
            const group = screen.getByRole('group', { name: question });
            const radios = group.querySelectorAll('input[type="radio"]');
            expect(radios).toHaveLength(2);
            for (const radio of radios) {
                expect(radio).not.toBeChecked();
                expect(radio).toBeRequired();
            }
        }
        expect(document.getElementById('emp-fmcsrs-0-yes')).not.toBeNull();
        expect(document.getElementById('emp-dot-tested-0-no')).not.toBeNull();
    });

    it('asks about a job whose dates are not filled in yet', () => {
        renderStep({ employers: [employer({ startDate: '', endDate: '' })] });

        expect(screen.getByRole('group', { name: fmcsrsQuestion })).toBeInTheDocument();
    });

    it('does not ask about a job that ended before the three years', () => {
        renderStep({ employers: [employer({ startDate: '2015-01-01', endDate: '2019-05-31' })] });

        expect(screen.queryByRole('group', { name: fmcsrsQuestion })).not.toBeInTheDocument();
        expect(screen.queryByRole('group', { name: dotTestingQuestion })).not.toBeInTheDocument();
    });

    // The questions leave with a job that moves before the three years, and so
    // must their answers, or the record would hold answers to questions the page
    // no longer asks.
    it('drops the two answers when the end date moves before the three years', () => {
        const row = employer({ endDate: '2024-05-31', subjectToFmcsrs: 'yes', subjectToDotTesting: 'no' });
        const { updateFormData } = renderStep({ employers: [row] });

        fireEvent.change(document.getElementById('emp-end-0-year'), { target: { value: '2019' } });

        const [updated] = updateFormData.mock.calls
            .filter(([key]) => key === 'employers')
            .reduce((list, [, update]) => update(list), [row]);
        expect(updated.endDate).toMatch(/^2019-05/);
        expect(updated.subjectToFmcsrs).toBe('');
        expect(updated.subjectToDotTesting).toBe('');
    });

    it('keeps the answers when the end date stays within the three years', () => {
        const row = employer({ endDate: '2024-05-31', subjectToFmcsrs: 'yes', subjectToDotTesting: 'no' });
        const { updateFormData } = renderStep({ employers: [row] });

        fireEvent.change(document.getElementById('emp-end-0-year'), { target: { value: '2025' } });

        const [updated] = updateFormData.mock.calls
            .filter(([key]) => key === 'employers')
            .reduce((list, [, update]) => update(list), [row]);
        expect(updated.endDate).toMatch(/^2025-05/);
        expect(updated).toMatchObject({ subjectToFmcsrs: 'yes', subjectToDotTesting: 'no' });
    });

    it('requires the reason for leaving', () => {
        renderStep({ employers: [employer()] });

        expect(document.getElementById('emp-reason-0')).toBeRequired();
    });

    it('keeps each row\'s answers apart and saves them under the verification portal\'s names', () => {
        const { updateFormData } = renderStep({ employers: [employer(), employer({ companyName: 'Second Freight' })] });

        fireEvent.click(document.getElementById('emp-fmcsrs-1-yes'));

        expect(updateFormData).toHaveBeenCalledWith('employers', expect.any(Function));
        const update = updateFormData.mock.calls.at(-1)[1];
        const [first, second] = update([employer(), employer({ companyName: 'Second Freight' })]);
        expect(second.subjectToFmcsrs).toBe('yes');
        expect(first.subjectToFmcsrs).toBe('');
    });

    it('leaves the questions optional where the company made employment history optional', () => {
        company.profile = { applicationConfig: { employmentHistory: { hidden: false, required: false } } };
        renderStep({ employers: [employer()] });

        expect(document.getElementById('emp-fmcsrs-0-yes')).not.toBeRequired();
        expect(document.getElementById('emp-reason-0')).not.toBeRequired();
    });
});
