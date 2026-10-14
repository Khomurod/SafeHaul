// Page one takes any address the final pre-flight takes.
//
// Continue on page one checked the email against a pattern of its own, stricter
// than `isValidEmail`, which the field's inline check, the Submit pre-flight and
// every other form use: o'neil@example.com, and any address outside plain ASCII,
// could not get past page one, though Submit would have taken them.

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Step1_Contact from './Step1_Contact';

const showError = vi.hoisted(() => vi.fn());

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { applicationConfig: {} } }),
}));
vi.mock('@shared/hooks/useUtils', () => ({
    useUtils: () => ({ states: ['TX', 'CA'] }),
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showError }),
}));

/** Every answer page one asks for, so Continue reaches the email check. */
const PAGE_ONE = {
    'known-by-other-name': 'no',
    firstName: 'Ada',
    lastName: "O'Neil",
    phone: '5125550142',
    street: '2210 Elm St',
    city: 'Austin',
    state: 'Texas',
    zip: '78701',
    dob: '1984-03-14',
};

function pressContinue(email) {
    render(
        <form id="driver-form">
            <Step1_Contact
                formData={{ ...PAGE_ONE, email }}
                updateFormData={vi.fn()}
                onNavigate={vi.fn()}
                onPartialSubmit={vi.fn()}
            />
        </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
}

beforeEach(() => {
    showError.mockReset();
});

describe('Step 1 — the email Continue accepts', () => {
    it.each(["o'neil@example.com", 'josé@correo.mx', 'ada+jobs@mail.example.co'])(
        'takes %s, as Submit does',
        (email) => {
            pressContinue(email);
            expect(showError).not.toHaveBeenCalledWith('Please enter a valid email address.');
        },
    );

    it.each(['ada@', 'ada.example.com', 'ada @example.com'])('still refuses %s', (email) => {
        pressContinue(email);
        expect(showError).toHaveBeenCalledWith('Please enter a valid email address.');
    });
});
