// Where a driver has lived, and where an accident happened, may be outside the
// fifty states: the pickers list DC and the five territories with the states, and
// Canada's and Mexico's regions after them. An address outside the US asks for a
// postal code, which in Canada has letters a phone's number pad cannot type.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Step1_Contact from './Step1_Contact';
import Step5_Accidents from './Step5_Accidents';
import { PreviousAddressesSection } from './components/PreviousAddressesSection';
import { postalCodeField } from './components/postalCodeField';

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { applicationConfig: {} } }),
}));

vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showError: vi.fn() }),
}));

vi.mock('@features/driver-app/hooks/useApplicationRules', () => ({
    useStepGate: () => ({
        rules: {}, blocking: [], attempted: false,
        issuesRef: { current: null }, refuseIfBlocked: () => false,
    }),
}));

const groupsOf = (select) => [...select.querySelectorAll('optgroup')].map((group) => group.label);
const optionsOf = (select) => [...select.options].map((option) => option.value);

function renderContact(formData) {
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
}

describe('the current address', () => {
    it('lists the states and territories, then Canada and Mexico', () => {
        renderContact({});
        const select = document.getElementById('state');
        expect(groupsOf(select)).toEqual(['United States', 'Canada', 'Mexico']);
        expect(optionsOf(select)).toEqual(expect.arrayContaining(['Puerto Rico', 'Guam', 'Ontario', 'Jalisco']));
    });

    it('asks a Canadian address for a postal code it can type, and does not call it a bad ZIP', () => {
        renderContact({ state: 'Ontario', zip: 'M5V 2T6' });
        const field = screen.getByLabelText(/^Postal Code/);
        expect(field).toHaveAttribute('id', 'zip');
        expect(field).toHaveAttribute('inputmode', 'text');
        expect(screen.queryByText('Standard ZIP is 5 digits.')).toBeNull();
    });

    it('still asks a US address for a five-digit ZIP Code', () => {
        renderContact({ state: 'Texas', zip: '7870' });
        expect(screen.getByLabelText(/^ZIP Code/)).toHaveAttribute('inputmode', 'numeric');
        expect(screen.getByText('Standard ZIP is 5 digits.')).toBeInTheDocument();
    });
});

describe('a previous address', () => {
    it('may be in Canada or Mexico too, with a postal code', () => {
        const formData = { previousAddresses: [{ street: '1 Calle', city: 'Monterrey', state: 'Nuevo León', zip: '64000', startDate: '', endDate: '' }] };
        render(<PreviousAddressesSection formData={formData} updateFormData={vi.fn()} ty={2026} />);
        expect(groupsOf(document.getElementById('prev-state-0'))).toEqual(['United States', 'Canada', 'Mexico']);
        expect(screen.getByLabelText(/^Postal Code/)).toHaveAttribute('id', 'prev-zip-0');
    });
});

describe('an accident', () => {
    it('may have happened in Canada or Mexico', () => {
        const formData = { 'has-accidents': 'yes', accidents: [{ date: '2025-03-01', city: 'Montreal', state: 'Quebec', details: 'x' }] };
        render(<form id="driver-form"><Step5_Accidents formData={formData} updateFormData={vi.fn()} onNavigate={vi.fn()} onPartialSubmit={vi.fn()} /></form>);
        const select = document.getElementById('accident-state-0');
        expect(groupsOf(select)).toEqual(['United States', 'Canada', 'Mexico']);
        expect(select).toHaveValue('Quebec');
        expect(within(select).queryByText('Quebec')).not.toBeNull();
    });
});

describe('postalCodeField', () => {
    it.each([
        ['Ontario', { label: 'Postal Code', inputMode: 'text', isZip: false }],
        ['Jalisco', { label: 'Postal Code', inputMode: 'numeric', isZip: false }],
        ['Texas', { label: 'ZIP Code', inputMode: 'numeric', isZip: true }],
        ['Puerto Rico', { label: 'ZIP Code', inputMode: 'numeric', isZip: true }],
        ['', { label: 'ZIP Code', inputMode: 'numeric', isZip: true }],
    ])('asks an address in %p for %o', (region, expected) => {
        expect(postalCodeField(region)).toMatchObject(expected);
    });
});
