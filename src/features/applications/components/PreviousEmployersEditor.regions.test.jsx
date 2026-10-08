// The recruiter's employer editor offers the regions the driver's Employment
// page offers, so a Canadian or Mexican employer the driver picked from FMCSA's
// census reads correctly and can be corrected.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviousEmployersEditor } from './PreviousEmployersEditor';

const ROW = { companyName: 'Northern Line Carriers', state: 'Ontario' };
const stateSelect = () => screen.getByLabelText('State');

describe("an employer's state or province in the editor", () => {
    it('shows a province the driver picked, and offers Mexico\'s states too', () => {
        const onChange = vi.fn();
        render(<PreviousEmployersEditor employers={[ROW]} onChange={onChange} />);

        expect(stateSelect()).toHaveValue('Ontario');
        expect(screen.getAllByRole('option', { name: 'Ontario' })).toHaveLength(1);

        fireEvent.change(stateSelect(), { target: { value: 'Nuevo León' } });
        expect(onChange).toHaveBeenCalledWith([{ ...ROW, state: 'Nuevo León' }]);
    });

    it('shows a stored value it does not list as itself, not as "Select…"', () => {
        render(<PreviousEmployersEditor employers={[{ ...ROW, state: 'ON' }]} onChange={vi.fn()} />);

        expect(stateSelect()).toHaveValue('ON');
        expect(stateSelect().selectedOptions[0]).toHaveTextContent('ON');
    });
});
