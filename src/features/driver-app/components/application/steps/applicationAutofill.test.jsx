// Which fields the phone may fill from the applicant's saved contact card.
//
// Page 1's own name, contact and current-address fields carry autofill tokens,
// and SSN and ZIP open the number pad. Every row about someone or somewhere else
// (a previous address, an employer, the carrier lookup) turns autofill off, so
// filling page 1 from the phone can never copy the applicant's own address or
// phone number into those rows.

import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Step1_Contact from './Step1_Contact';
import Step3_License from './Step3_License';
import Step6_Employment from './Step6_Employment';

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { applicationConfig: {} } }),
}));
vi.mock('@shared/hooks/useUtils', () => ({
    useUtils: () => ({ states: ['Texas', 'California'] }),
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

afterEach(cleanup);

const byId = (id) => document.getElementById(id);

const renderStep1 = (formData = {}) => render(
    <form id="driver-form">
        <Step1_Contact
            formData={{ 'known-by-other-name': 'no', ...formData }}
            updateFormData={vi.fn()}
            onNavigate={vi.fn()}
            onPartialSubmit={vi.fn()}
        />
    </form>,
);

describe("page 1 offers the applicant's own details to autofill", () => {
    it('tags name, contact, date of birth and current address with their tokens', () => {
        renderStep1();
        const expected = {
            'first-name': 'given-name',
            'middle-name': 'additional-name',
            'last-name': 'family-name',
            suffix: 'honorific-suffix',
            phone: 'tel',
            email: 'email',
            street: 'address-line1',
            city: 'address-level2',
            state: 'address-level1',
            zip: 'postal-code',
            'dob-month': 'bday-month',
            'dob-day': 'bday-day',
            'dob-year': 'bday-year',
        };
        for (const [id, token] of Object.entries(expected)) {
            expect(byId(id), id).toHaveAttribute('autocomplete', token);
        }
    });

    it('opens the number pad for SSN and ZIP, and keeps the SSN masked and out of autofill', () => {
        renderStep1();
        const ssn = byId('ssn');
        expect(ssn).toHaveAttribute('type', 'password');
        expect(ssn).toHaveAttribute('inputmode', 'numeric');
        expect(ssn).toHaveAttribute('autocomplete', 'off');
        expect(byId('zip')).toHaveAttribute('inputmode', 'numeric');
    });

    it("turns autofill off on a previous address, which shares the current address's field names", () => {
        renderStep1({
            previousAddresses: [{ street: '', city: '', state: '', zip: '', startDate: '', endDate: '' }],
        });
        for (const id of ['prev-street-0', 'prev-city-0', 'prev-state-0', 'prev-zip-0']) {
            expect(byId(id), id).toHaveAttribute('autocomplete', 'off');
        }
    });
});

describe('the licence number keeps its letters', () => {
    it('capitalises, and neither autocorrects, spell-checks nor autofills', () => {
        render(
            <form id="driver-form">
                <Step3_License
                    formData={{ 'has-other-licenses': 'no', 'has-twic': 'no' }}
                    updateFormData={vi.fn()}
                    handleFileUpload={vi.fn()}
                    onNavigate={vi.fn()}
                    isUploading={false}
                />
            </form>,
        );
        const input = byId('cdl-number');
        expect(input).toHaveAttribute('autocapitalize', 'characters');
        expect(input).toHaveAttribute('autocorrect', 'off');
        expect(input).toHaveAttribute('spellcheck', 'false');
        expect(input).toHaveAttribute('autocomplete', 'off');
    });
});

describe("employer rows never receive the applicant's own details", () => {
    it('turns autofill off on the carrier lookup and every address and contact field', () => {
        render(
            <form id="driver-form">
                <Step6_Employment
                    formData={{ employers: [{ companyName: '', address: '', city: '', state: '', phone: '', startDate: '', endDate: '' }] }}
                    updateFormData={vi.fn()}
                    onNavigate={vi.fn()}
                />
            </form>,
        );
        const ids = [
            'emp-name-0', 'emp-street-0', 'emp-city-0', 'emp-state-0', 'emp-phone-0',
            'emp-co-email-0', 'emp-supervisor-0', 'emp-sup-phone-0', 'emp-sup-email-0',
        ];
        for (const id of ids) {
            expect(byId(id), id).toHaveAttribute('autocomplete', 'off');
        }
    });
});
