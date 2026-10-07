import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StateSelectField } from './StateSelectField';
import { US_STATE_NAMES } from '@shared/utils/usStates';
import { EMPLOYER_REGION_GROUPS } from '@shared/utils/northAmericanRegions';

afterEach(cleanup);

function renderPicker(value) {
    render(
        <StateSelectField id="state" name="state" value={value} onChange={vi.fn()} states={US_STATE_NAMES} />,
    );
    return screen.getByLabelText(/State/);
}

describe('StateSelectField shows the value the form holds', () => {
    it('selects a listed state', () => {
        const select = renderPicker('Texas');
        expect(select).toHaveValue('Texas');
        expect(select.selectedOptions[0]).toHaveTextContent('Texas');
    });

    it('shows a value it does not list as itself, never as a neighbour', () => {
        // The reported shape: a CDL auto-fill or a carrier wrote "TX", and with no
        // option for it React selected the first one it could — "Alabama" — while
        // the form went on holding "TX".
        const select = renderPicker('TX');
        expect(select).toHaveValue('TX');
        expect(select.selectedOptions[0]).toHaveTextContent('TX');
        expect(select.selectedOptions[0]).not.toHaveTextContent('Alabama');
    });

    it('asks for a state when there is none', () => {
        const select = renderPicker('');
        expect(select).toHaveValue('');
        expect(select.selectedOptions[0]).toHaveTextContent('Select State');
        expect(screen.queryByRole('option', { name: 'TX' })).toBeNull();
    });
});

describe('StateSelectField error', () => {
    it('marks the select invalid and says why', () => {
        render(<StateSelectField id="emp-state-0" name="state" value="" onChange={vi.fn()} states={US_STATE_NAMES} error="Required." />);

        const select = screen.getByLabelText(/State/);
        expect(select).toHaveAttribute('aria-invalid', 'true');
        expect(select).toBeRequired();
        expect(document.getElementById(select.getAttribute('aria-describedby'))).toHaveTextContent('Required.');
    });
});

describe('StateSelectField autofill token', () => {
    it('has none unless the caller passes one', () => {
        expect(renderPicker('')).not.toHaveAttribute('autocomplete');
    });

    it('passes the token the current address asks for', () => {
        render(
            <StateSelectField id="state" name="state" value="" onChange={vi.fn()} states={US_STATE_NAMES} autoComplete="address-level1" />,
        );
        expect(screen.getByLabelText(/State/)).toHaveAttribute('autocomplete', 'address-level1');
    });
});

describe('StateSelectField groups', () => {
    function renderRegions(value) {
        render(
            <StateSelectField
                id="emp-state-0" name="state" value={value} onChange={vi.fn()}
                groups={EMPLOYER_REGION_GROUPS} label="State / Province" placeholder="Select state or province"
            />,
        );
        return screen.getByLabelText(/State \/ Province/);
    }

    it('offers the US states, then Canada and Mexico, under their country', () => {
        const select = renderRegions('');
        expect([...select.querySelectorAll('optgroup')].map((group) => group.label)).toEqual(['United States', 'Canada', 'Mexico']);
        expect(screen.getByRole('group', { name: 'Canada' })).toContainElement(screen.getByRole('option', { name: 'Ontario' }));
        expect(select.selectedOptions[0]).toHaveTextContent('Select state or province');
    });

    it('selects a province once, and still shows an unlisted value as itself', () => {
        expect(renderRegions('Ontario')).toHaveValue('Ontario');
        expect(screen.getAllByRole('option', { name: 'Ontario' })).toHaveLength(1);
        cleanup();

        const select = renderRegions('ON');
        expect(select).toHaveValue('ON');
        expect(select.selectedOptions[0]).toHaveTextContent('ON');
    });
});
