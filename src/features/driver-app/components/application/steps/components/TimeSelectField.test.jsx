// The time lists that replaced `<input type="time">`: what they store, when, and
// how they hold a page while a time is half chosen. All values are made up.
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';

import TimeSelectField from './TimeSelectField';

/** A parent that keeps what the field emits, as the wizard does. */
function Controlled({ initial = '', onChange = vi.fn(), required = true }) {
    const [value, setValue] = useState(initial);
    return (
        <form id="driver-form">
            <TimeSelectField
                label="Last relieved from duty — time"
                idPrefix="relieved"
                name="hosLastRelievedTime"
                value={value}
                onChange={(name, next) => { setValue(next); onChange(name, next); }}
                required={required}
            />
            <output data-testid="stored">{value}</output>
        </form>
    );
}

const pick = (part, value) => fireEvent.change(document.getElementById(`relieved-${part}`), { target: { value } });
const stored = () => screen.getByTestId('stored').textContent;

describe('TimeSelectField', () => {
    it('stores the 24-hour HH:MM an <input type="time"> stored, once all three are chosen', () => {
        const onChange = vi.fn();
        render(<Controlled onChange={onChange} />);
        pick('hour', '6');
        pick('minute', '05');
        expect(onChange).not.toHaveBeenCalled();
        pick('period', 'PM');
        expect(onChange).toHaveBeenLastCalledWith('hosLastRelievedTime', '18:05');
        expect(stored()).toBe('18:05');
    });

    it.each([
        ['12', '00', 'AM', '00:00'],
        ['12', '30', 'PM', '12:30'],
        ['1', '15', 'AM', '01:15'],
        ['11', '59', 'PM', '23:59'],
    ])('reads %s:%s %s as %s', (hour, minute, period, expected) => {
        render(<Controlled />);
        pick('hour', hour);
        pick('minute', minute);
        pick('period', period);
        expect(stored()).toBe(expected);
    });

    it.each([
        ['07:45', '7', '45', 'AM'],
        ['00:15', '12', '15', 'AM'],
        ['12:30', '12', '30', 'PM'],
        ['23:59', '11', '59', 'PM'],
    ])('shows a stored %s in the three lists as %s:%s %s', (initial, hour, minute, period) => {
        render(<Controlled initial={initial} />);
        expect(document.getElementById('relieved-hour')).toHaveValue(hour);
        expect(document.getElementById('relieved-minute')).toHaveValue(minute);
        expect(document.getElementById('relieved-period')).toHaveValue(period);
    });

    it('clears the stored time when a part is unset again, and keeps the other two', () => {
        render(<Controlled initial="18:30" />);
        pick('minute', '');
        expect(stored()).toBe('');
        expect(document.getElementById('relieved-hour')).toHaveValue('6');
        expect(document.getElementById('relieved-period')).toHaveValue('PM');
    });

    it('holds the page on the list still empty while the time is half chosen', () => {
        render(<Controlled />);
        const form = document.getElementById('driver-form');
        expect(form.checkValidity()).toBe(false);
        pick('hour', '9');
        pick('period', 'AM');
        const invalid = [...form.querySelectorAll('select')].filter((select) => !select.checkValidity()).map((select) => select.id);
        expect(invalid).toEqual(['relieved-minute']);
        pick('minute', '10');
        expect(form.checkValidity()).toBe(true);
    });

    it('holds the page on a half-chosen time even when the question is optional', () => {
        render(<Controlled required={false} />);
        const form = document.getElementById('driver-form');
        expect(form.checkValidity()).toBe(true);
        pick('hour', '6');
        pick('period', 'PM');
        expect(form.checkValidity()).toBe(false);
        expect(document.getElementById('relieved-minute').validationMessage).toBe('Choose the hour, minutes and AM or PM.');
        expect(document.getElementById('relieved-hour').checkValidity()).toBe(true);
        pick('minute', '15');
        expect(form.checkValidity()).toBe(true);
        expect(stored()).toBe('18:15');
        pick('hour', '');
        pick('minute', '');
        pick('period', '');
        expect(form.checkValidity()).toBe(true);
    });

    it('names each list after the question', () => {
        render(<Controlled />);
        expect(screen.getByRole('group', { name: /Last relieved from duty — time/ })).toBeInTheDocument();
        expect(screen.getByLabelText('Last relieved from duty — time hour')).toBeInstanceOf(HTMLSelectElement);
        expect(screen.getByLabelText('Last relieved from duty — time minutes')).toBeInstanceOf(HTMLSelectElement);
        expect(screen.getByLabelText('Last relieved from duty — time AM or PM')).toBeInstanceOf(HTMLSelectElement);
    });

    it('offers every minute, and the hours 12 then 1 to 11', () => {
        render(<Controlled />);
        const values = (part) => [...document.getElementById(`relieved-${part}`).options].map((option) => option.value).filter(Boolean);
        expect(values('hour')).toEqual(['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
        expect(values('minute')).toHaveLength(60);
        expect(values('period')).toEqual(['AM', 'PM']);
    });

    it('ignores a stored value that is not a time', () => {
        render(<Controlled initial="25:99" />);
        expect(document.getElementById('relieved-hour')).toHaveValue('');
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<Controlled />);
        expect((await axe(container)).violations).toEqual([]);
    });
});
