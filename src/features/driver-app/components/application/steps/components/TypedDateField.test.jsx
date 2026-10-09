// The typed date field: what it stores, when, and how it holds a page that
// carries a half-typed or impossible date. All fixtures are artificial dates.
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TypedDateField from './TypedDateField';

const FIXED_NOW = new Date('2026-10-06T12:00:00Z');

function renderField(overrides = {}) {
    const onChange = vi.fn();
    const props = {
        label: 'Date of Birth',
        idPrefix: 'dob',
        name: 'dob',
        value: '',
        onChange,
        required: true,
        maxToday: true,
        minYear: 1920,
        ...overrides,
    };
    return { ...render(<TypedDateField {...props} />), onChange };
}

/** A parent that keeps what the field emits, as the wizard does. */
function ControlledField({ initial = '', onChange }) {
    const [value, setValue] = useState(initial);
    return (
        <TypedDateField
            label="Date of Birth"
            idPrefix="dob"
            name="dob"
            value={value}
            onChange={(name, next) => { setValue(next); onChange(name, next); }}
            required
            maxToday
            minYear={1920}
        />
    );
}

const box = (part) => document.getElementById(`dob-${part}`);
const type = (part, text) => fireEvent.change(box(part), { target: { value: text } });

function typeDate(month, day, year) {
    type('month', month);
    type('day', day);
    type('year', year);
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('TypedDateField', () => {
    it('opens the number pad in three labelled boxes with the frozen ids', () => {
        renderField();

        for (const [part, length] of [['month', 2], ['day', 2], ['year', 4]]) {
            expect(box(part)).toHaveAttribute('inputmode', 'numeric');
            expect(box(part)).toHaveAttribute('maxlength', String(length));
            expect(box(part)).toBeRequired();
        }
        expect(screen.getByLabelText('Date of Birth Month')).toBe(box('month'));
        expect(screen.getByRole('group', { name: /Date of Birth/ })).toBeInTheDocument();
    });

    it('stores YYYY-MM-DD once the three boxes make a real date, and not before', () => {
        const { onChange } = renderField();

        type('month', '3');
        type('day', '14');
        expect(onChange).not.toHaveBeenCalled();
        type('year', '1984');

        expect(onChange).toHaveBeenLastCalledWith('dob', '1984-03-14');
    });

    it('keeps only digits', () => {
        const { onChange } = renderField();

        typeDate('0a3', '1-4', '19 84');

        expect(box('month')).toHaveValue('03');
        expect(onChange).toHaveBeenLastCalledWith('dob', '1984-03-14');
    });

    it('shows a stored date in the boxes', () => {
        renderField({ value: '1984-03-14' });

        expect(box('month')).toHaveValue('3');
        expect(box('day')).toHaveValue('14');
        expect(box('year')).toHaveValue('1984');
    });

    it('holds the page on a date that does not exist, and says why', () => {
        const { onChange } = renderField();

        typeDate('02', '30', '1990');

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('Enter a day that exists in that month.');
        expect(box('day').checkValidity()).toBe(false);
        expect(box('day')).toHaveAttribute('aria-invalid', 'true');
    });

    it('refuses a date in the future', () => {
        renderField();

        typeDate('01', '01', '2027');

        expect(screen.getByRole('alert')).toHaveTextContent('The date cannot be in the future.');
        expect(box('year').checkValidity()).toBe(false);
    });

    it('refuses a year before the earliest allowed', () => {
        renderField();

        typeDate('01', '01', '1899');

        expect(screen.getByRole('alert')).toHaveTextContent('Enter a four-digit year from 1920.');
    });

    it('holds the page on a half-typed date without interrupting the typing', () => {
        renderField({ required: false });

        type('month', '03');

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(box('day').checkValidity()).toBe(false);
        expect(box('day').validationMessage).toBe('Enter the month, day and year.');
    });

    it('clears the stored date when a box is emptied, and keeps the rest typed', () => {
        const onChange = vi.fn();
        render(<ControlledField initial="1984-03-14" onChange={onChange} />);

        type('day', '');

        expect(onChange).toHaveBeenLastCalledWith('dob', '');
        expect(box('month')).toHaveValue('3');
        expect(box('year')).toHaveValue('1984');
    });

    it('shows and announces the page’s own message, on every box', () => {
        renderField({ error: 'Enter your date of birth.' });

        const message = screen.getByRole('alert');
        expect(message).toHaveTextContent('Enter your date of birth.');
        expect(screen.getByRole('group', { name: /Date of Birth/ })).toHaveAttribute('aria-describedby', message.id);
        for (const part of ['month', 'day', 'year']) {
            expect(box(part)).toHaveAttribute('aria-invalid', 'true');
        }
    });

    it('says what is wrong with an impossible date instead of the page’s message, never both', () => {
        renderField({ error: 'Enter your date of birth.' });

        typeDate('02', '30', '1990');

        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(screen.getByRole('alert')).toHaveTextContent('Enter a day that exists in that month.');
        expect(box('day')).toHaveAttribute('aria-invalid', 'true');
        expect(box('month')).not.toHaveAttribute('aria-invalid');
    });

    it('gives the boxes the birthday autofill tokens only when asked', () => {
        renderField({ autoComplete: 'bday' });
        expect(box('month')).toHaveAttribute('autocomplete', 'bday-month');
        expect(box('day')).toHaveAttribute('autocomplete', 'bday-day');
        expect(box('year')).toHaveAttribute('autocomplete', 'bday-year');
    });

    it('has no accessibility violations, empty or with an error', async () => {
        const { container } = renderField();
        expect((await axe(container)).violations).toEqual([]);
        typeDate('02', '30', '1990');
        expect((await axe(container)).violations).toEqual([]);
    });
});
