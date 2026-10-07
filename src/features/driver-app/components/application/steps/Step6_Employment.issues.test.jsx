// What the Employment page still needs, listed at the top after Continue.
//
// The page used to answer Continue with the browser's bubble on the first empty
// field, gone in a couple of seconds, and a toast per email problem. A driver
// who picked a company from SAFER saw it fill in, pressed Continue, and could
// not tell what was left. These pin the list that replaced both: what it says,
// where each line goes, what it marks, and that it covers every required field.

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Step6_Employment from './Step6_Employment';

const company = vi.hoisted(() => ({ profile: null }));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: company.profile }),
}));
vi.mock('@shared/hooks/useUtils', () => ({
    useUtils: () => ({ states: ['Texas', 'California'] }),
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

const NOW = new Date('2026-10-07T12:00:00Z');

// What a SAFER pick fills in: the identity and a phone, nothing else.
const pickedFromSafer = (overrides = {}) => ({
    companyName: 'Artificial Freight Co', address: '1 Test Way', city: 'Springfield', state: 'Texas',
    phone: '5555550100', startDate: '', endDate: '', reasonForLeaving: '',
    subjectToFmcsrs: '', subjectToDotTesting: '', ...overrides,
});
const answered = (overrides = {}) => pickedFromSafer({
    startDate: '2020-01', endDate: '2026-10', reasonForLeaving: 'Still employed',
    subjectToFmcsrs: 'yes', subjectToDotTesting: 'yes', ...overrides,
});

function renderStep(formData) {
    const onNavigate = vi.fn();
    const props = { updateFormData: vi.fn(), onNavigate };
    const view = render(
        <form id="driver-form">
            <Step6_Employment formData={formData} {...props} />
        </form>,
    );
    const rerender = (next) => view.rerender(
        <form id="driver-form">
            <Step6_Employment formData={next} {...props} />
        </form>,
    );
    return { onNavigate, rerender };
}

const clickContinue = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
const list = () => screen.getByTestId('step-blocking-issues');
const lines = () => within(list()).getAllByRole('listitem').map((item) => item.textContent);

describe('Step6_Employment — what is missing', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(NOW);
        Element.prototype.scrollIntoView = vi.fn();
        company.profile = { applicationConfig: {} };
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('lists what a row picked from SAFER still needs, at the top, and stays on the page', () => {
        const { onNavigate } = renderStep({ employers: [pickedFromSafer()] });
        expect(screen.queryByTestId('step-blocking-issues')).not.toBeInTheDocument();

        clickContinue();

        expect(onNavigate).not.toHaveBeenCalled();
        expect(within(list()).getByText('Before you continue:')).toBeInTheDocument();
        expect(lines()).toEqual(['Employer 1: start date, end date, reason for leaving, 2 questions.']);
        // Focus moves to the list, so it is announced and on screen.
        expect(document.activeElement).toBe(list());
    });

    it('takes the applicant to the first missing field of the line', () => {
        renderStep({ employers: [pickedFromSafer()] });
        clickContinue();

        fireEvent.click(within(list()).getByRole('link', { name: /Employer 1:/ }));

        expect(document.activeElement).toBe(document.getElementById('emp-start-0-month'));
    });

    it('marks each missing field, and only those', () => {
        renderStep({ employers: [pickedFromSafer()] });
        clickContinue();

        expect(document.getElementById('emp-start-0-month')).toHaveAttribute('aria-invalid', 'true');
        expect(document.getElementById('emp-start-0-year')).toHaveAttribute('aria-invalid', 'true');
        expect(document.getElementById('emp-reason-0')).toHaveAttribute('aria-invalid', 'true');
        expect(document.getElementById('emp-fmcsrs-0-yes').closest('fieldset')).toHaveAttribute('data-invalid', 'true');
        expect(document.getElementById('emp-city-0')).not.toHaveAttribute('aria-invalid');
        expect(document.getElementById('emp-state-0')).not.toHaveAttribute('aria-invalid');
    });

    it('shrinks as the applicant fills it in, and goes once nothing is missing', () => {
        const { rerender } = renderStep({ employers: [pickedFromSafer()] });
        clickContinue();

        rerender({ employers: [pickedFromSafer({ startDate: '2020-01', endDate: '2026-10', subjectToFmcsrs: 'yes' })] });
        expect(lines()).toEqual(['Employer 1: reason for leaving, 1 question.']);
        expect(document.getElementById('emp-start-0-month')).not.toHaveAttribute('aria-invalid');

        rerender({ employers: [answered()] });
        expect(screen.queryByTestId('step-blocking-issues')).not.toBeInTheDocument();
    });

    it('names a mistyped email and a missing contact on the line, not in a toast', () => {
        renderStep({
            employers: [
                answered({ companyEmail: 'not-an-email' }),
                answered({ phone: '', supervisorEmail: 'boss@' }),
                answered({ phone: '' }),
            ],
        });
        clickContinue();

        expect(lines()).toEqual([
            'Employer 1: a valid company email.',
            'Employer 2: a valid supervisor email.',
            'Employer 3: a phone or email to verify the job.',
        ]);
        expect(screen.getByText('Enter a valid email, or leave it blank.', { selector: '#emp-co-email-0-error' })).toBeInTheDocument();
        expect(document.getElementById('emp-phone-2')).toHaveAttribute('aria-invalid', 'true');
    });

    it('lists the gap, school and military rows too', () => {
        renderStep({
            employers: [answered()],
            unemployment: [{ startDate: '2024-01', endDate: '', details: '' }],
            schools: [{ name: '', startDate: '', endDate: '', location: '' }],
            military: [{ branch: 'Army', start: '2010-01', end: '2014-01', rank: '', heavyEq: 'no', honorable: 'yes' }],
        });
        clickContinue();

        expect(lines()).toEqual([
            'Employment gap 1: gap end.',
            'Driving school 1: school name, start date, end date.',
            'Military service 1: rank of discharge.',
        ]);
        fireEvent.click(within(list()).getByRole('link', { name: /Military service 1:/ }));
        expect(document.activeElement).toBe(document.getElementById('mil-rank-0'));
    });

    it('lets a row added after Continue wait for the next Continue', () => {
        const { rerender } = renderStep({ employers: [pickedFromSafer()] });
        clickContinue();

        rerender({ employers: [pickedFromSafer(), pickedFromSafer({ companyName: '', address: '', city: '', state: '', phone: '' })] });

        expect(lines()).toEqual(['Employer 1: start date, end date, reason for leaving, 2 questions.']);
        expect(document.getElementById('emp-name-1')).not.toHaveAttribute('aria-invalid');
    });

    it('asks only for what the company requires: an optional history is not listed', () => {
        company.profile = { applicationConfig: { employmentHistory: { hidden: false, required: false } } };
        const { onNavigate } = renderStep({ employers: [pickedFromSafer({ startDate: '2020-01', endDate: '2026-10' })] });
        const form = document.getElementById('driver-form');
        form.checkValidity = vi.fn(() => true);

        clickContinue();

        expect(screen.queryByTestId('step-blocking-issues')).not.toBeInTheDocument();
        expect(onNavigate).toHaveBeenCalledWith('next');
    });

    it('still lets a page with no employers through with Continue anyway', () => {
        const { onNavigate } = renderStep({ employers: [] });
        document.getElementById('driver-form').checkValidity = vi.fn(() => true);

        clickContinue();
        expect(screen.queryByTestId('step-blocking-issues')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Continue anyway' }));

        expect(onNavigate).toHaveBeenCalledWith('next');
    });

    // The list and the page's `required` attributes are two statements of one
    // rule. This holds them together: every control the page requires, left
    // empty, is one the list names and marks.
    it('names every field the page requires', () => {
        renderStep({
            employers: [{}],
            unemployment: [{}],
            schools: [{}],
            military: [{}],
        });
        clickContinue();

        expect(lines().map((line) => line.split(':')[0])).toEqual([
            'Employer 1', 'Employment gap 1', 'Driving school 1', 'Military service 1',
        ]);
        const required = [...document.querySelectorAll('#page-6 [required]')];
        expect(required.length).toBeGreaterThan(20);
        const unmarked = required.filter((control) => (control.type === 'radio'
            ? control.closest('fieldset')?.getAttribute('data-invalid') !== 'true'
            : control.getAttribute('aria-invalid') !== 'true'));
        expect(unmarked.map((control) => control.id || control.name)).toEqual([]);
    });
});
