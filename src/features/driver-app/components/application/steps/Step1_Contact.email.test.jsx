// Page one takes the addresses the final pre-flight takes.
//
// Continue on page one checked the email against a pattern of its own, stricter
// than `isValidEmail`, which the field's inline check, the Submit pre-flight and
// every other form use: o'neil@example.com could not get past page one, though
// Submit would have taken it. A letter outside ASCII is still refused, by the
// field's own `type="email"` check in the browser (Chromium marks josé@correo.mx
// a type mismatch); there it is almost always a keyboard's autocorrect, and the
// large mail providers issue no such addresses.

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

/** Every answer page one asks for, so Continue gets past every check on it. */
const PAGE_ONE = {
    'known-by-other-name': 'no',
    firstName: 'Ada',
    lastName: "O'Neil",
    ssn: '123-45-6789',
    phone: '5125550142',
    street: '2210 Elm St',
    city: 'Austin',
    state: 'Texas',
    zip: '78701',
    dob: '1984-03-14',
    'residence-3-years': 'yes',
};

function pressContinue(email) {
    const onNavigate = vi.fn();
    render(
        <form id="driver-form">
            <Step1_Contact
                formData={{ ...PAGE_ONE, email }}
                updateFormData={vi.fn()}
                onNavigate={onNavigate}
                onPartialSubmit={vi.fn()}
            />
        </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    return onNavigate;
}

beforeEach(() => {
    showError.mockReset();
});

describe('Step 1 — the email Continue accepts', () => {
    it.each(["o'neil@example.com", 'ada+jobs@mail.example.co'])(
        'takes %s and goes on to the next page, as Submit does',
        (email) => {
            const onNavigate = pressContinue(email);
            expect(showError).not.toHaveBeenCalled();
            expect(onNavigate).toHaveBeenCalledWith('next');
        },
    );

    it.each(['ada@', 'ada.example.com', 'ada @example.com'])('still refuses %s', (email) => {
        const onNavigate = pressContinue(email);
        expect(showError).toHaveBeenCalledWith('Please enter a valid email address.');
        expect(onNavigate).not.toHaveBeenCalled();
    });
});
