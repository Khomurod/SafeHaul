// Page one says what is wrong with the date of birth and the State at the field,
// not in a toast that is gone in seconds, and Continue refuses exactly what it
// refused before. All fixtures are artificial.
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Step1_Contact from './Step1_Contact';

const showError = vi.hoisted(() => vi.fn());
const companyProfile = vi.hoisted(() => ({ applicationConfig: {} }));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: companyProfile }),
}));
vi.mock('@shared/hooks/useUtils', () => ({
    useUtils: () => ({ states: ['TX', 'CA'] }),
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showError }),
}));

const UNDER_21 = 'This date of birth indicates you are under 21. '
    + 'Interstate CMV positions require age 21 or older — please verify the date.';
const SEVENTEEN = `${new Date().getFullYear() - 17}-01-01`;

/** Every answer page one asks for, so Continue gets past every check on it. */
const PAGE_ONE = {
    'known-by-other-name': 'no',
    firstName: 'Ada',
    lastName: 'Driver',
    ssn: '123-45-6789',
    phone: '5125550142',
    email: 'ada@example.com',
    street: '2210 Elm St',
    city: 'Austin',
    state: 'Texas',
    zip: '78701',
    dob: '1984-03-14',
    'residence-3-years': 'yes',
};

/** Page one holding its answers in state, as the wizard does. */
function PageOne({ initial, onNavigate }) {
    const [formData, setFormData] = useState(initial);
    return (
        <form id="driver-form">
            <Step1_Contact
                formData={formData}
                updateFormData={(name, value) => setFormData((previous) => ({ ...previous, [name]: value }))}
                onNavigate={onNavigate}
                onPartialSubmit={vi.fn()}
            />
        </form>
    );
}

function renderPage(answers = {}, applicationConfig = {}) {
    companyProfile.applicationConfig = applicationConfig;
    const onNavigate = vi.fn();
    render(<PageOne initial={{ ...PAGE_ONE, ...answers }} onNavigate={onNavigate} />);
    return onNavigate;
}

const pressContinue = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
const dobBoxes = () => ['month', 'day', 'year'].map((part) => document.getElementById(`dob-${part}`));

/** The message is the date field's own: announced, and describing every box. */
function expectAtTheDate(text) {
    const message = screen.getByText(text);
    expect(message).toHaveAttribute('role', 'alert');
    expect(message.id).toBeTruthy();
    for (const box of dobBoxes()) {
        expect(box.getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
        expect(box).toHaveAttribute('aria-invalid', 'true');
    }
    expect(screen.getByRole('group', { name: /Date of Birth/ }).getAttribute('aria-describedby')).toContain(message.id);
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe('Step 1 — the date of birth says what is wrong at the field', () => {
    it('says the age as soon as the date is under 21, and Continue stays refused without a toast', () => {
        const onNavigate = renderPage({ dob: SEVENTEEN });

        expectAtTheDate(UNDER_21);

        pressContinue();
        expect(onNavigate).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(document.getElementById('dob-month'));
        expect(screen.getAllByText(UNDER_21)).toHaveLength(1);
    });

    it('refuses a required date left empty, at the field, once Continue is pressed', () => {
        const onNavigate = renderPage({ dob: '' });
        expect(screen.queryByText('Date of birth is required.')).toBeNull();

        pressContinue();

        expectAtTheDate('Date of birth is required.');
        expect(onNavigate).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(document.getElementById('dob-month'));
    });

    it('refuses a required date that cannot be read, at the field', () => {
        const onNavigate = renderPage({ dob: 'not-a-date' });

        pressContinue();

        expectAtTheDate('Please enter a valid date of birth.');
        expect(onNavigate).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
    });

    it('takes the message away as the date is corrected, and then moves on', () => {
        const onNavigate = renderPage({ dob: '' });
        pressContinue();
        expect(screen.getByText('Date of birth is required.')).toBeInTheDocument();

        fireEvent.change(document.getElementById('dob-month'), { target: { value: '03' } });
        fireEvent.change(document.getElementById('dob-day'), { target: { value: '14' } });
        fireEvent.change(document.getElementById('dob-year'), { target: { value: '1984' } });
        expect(screen.queryByText('Date of birth is required.')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();

        pressContinue();
        expect(onNavigate).toHaveBeenCalledWith('next');
    });

    it('refuses an optional date under 21', () => {
        const optional = { dob: { required: false, hidden: false } };
        const refused = renderPage({ dob: SEVENTEEN }, optional);
        expectAtTheDate(UNDER_21);
        pressContinue();
        expect(refused).not.toHaveBeenCalled();
    });

    it('lets an optional date be left empty', () => {
        const onNavigate = renderPage({ dob: '' }, { dob: { required: false, hidden: false } });

        pressContinue();

        expect(onNavigate).toHaveBeenCalledWith('next');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('checks nothing about a date the company hides', () => {
        const onNavigate = renderPage({ dob: SEVENTEEN }, { dob: { hidden: true } });

        expect(screen.queryByText(UNDER_21)).toBeNull();
        pressContinue();
        expect(onNavigate).toHaveBeenCalledWith('next');
    });
});

describe('Step 1 — the State says it is missing at the field', () => {
    it('refuses a missing State under the list, with the focus on it and no toast', () => {
        const onNavigate = renderPage({ state: '' });
        expect(screen.queryByText('State is required.')).toBeNull();

        pressContinue();

        const message = screen.getByText('State is required.');
        expect(message).toHaveAttribute('role', 'alert');
        const select = document.getElementById('state');
        expect(select.getAttribute('aria-describedby')).toContain(message.id);
        expect(select).toHaveAttribute('aria-invalid', 'true');
        expect(document.activeElement).toBe(select);
        expect(showError).not.toHaveBeenCalled();
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('shows the date and the State beside a field the inline check names first', () => {
        const onNavigate = renderPage({ firstName: '', state: '', dob: '' });

        pressContinue();

        // The fields with a validator of their own keep their line and the toast.
        expect(showError).toHaveBeenCalledWith('First Name is required.');
        expect(document.activeElement).toBe(document.getElementById('first-name'));
        expect(screen.getByText('State is required.')).toBeInTheDocument();
        expectAtTheDate('Date of birth is required.');
        expect(onNavigate).not.toHaveBeenCalled();
    });
});
