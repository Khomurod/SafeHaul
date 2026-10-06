import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StateSelectField } from './StateSelectField';
import { US_STATE_NAMES } from '@shared/utils/usStates';

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
