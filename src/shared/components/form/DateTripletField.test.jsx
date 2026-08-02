// Focused coverage for the shared DateTripletField. The date logic is the
// contract seven consumers depend on (six driver-application steps plus
// SendTemplateWizard), so every emit, clamp and cap rule is pinned here. All
// fixtures are artificial dates.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DateTripletField from './DateTripletField';

const FIXED_NOW = new Date('2026-07-25T12:00:00Z');

let onChange;

function renderField(overrides = {}) {
    onChange = vi.fn();
    const props = {
        label: 'Date of Birth',
        idPrefix: 'dob',
        name: 'dateOfBirth',
        value: '',
        onChange,
        ...overrides,
    };
    return { ...render(<DateTripletField {...props} />), props };
}

function selects() {
    return {
        month: document.getElementById('dob-month'),
        day: document.getElementById('dob-day'),
        year: document.getElementById('dob-year'),
    };
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('DateTripletField — frozen element ids and structure', () => {
    it('keeps the idPrefix-based ids the public-application E2E selects', () => {
        renderField({ idPrefix: 'cdl-expiration' });
        expect(document.getElementById('cdl-expiration-month')).toBeTruthy();
        expect(document.getElementById('cdl-expiration-day')).toBeTruthy();
        expect(document.getElementById('cdl-expiration-year')).toBeTruthy();
    });

    it('groups the three controls under the field name', () => {
        renderField();
        const group = screen.getByRole('group', { name: /Date of Birth/ });
        expect(group).toBeInTheDocument();
        expect(group.querySelectorAll('select')).toHaveLength(3);
    });

    it('composes each control name from the field label', () => {
        renderField();
        expect(screen.getByLabelText('Date of Birth month')).toBe(selects().month);
        expect(screen.getByLabelText('Date of Birth day')).toBe(selects().day);
        expect(screen.getByLabelText('Date of Birth year')).toBe(selects().year);
    });

    it('falls back to bare part names when there is no label', () => {
        renderField({ label: undefined });
        expect(screen.getByLabelText('month')).toBeTruthy();
        expect(screen.getByLabelText('day')).toBeTruthy();
        expect(screen.getByLabelText('year')).toBeTruthy();
    });

    it('marks required with an accessible suffix, not colour alone', () => {
        renderField({ required: true });
        expect(screen.getByText('required')).toBeInTheDocument();
        for (const select of Object.values(selects())) {
            expect(select).toBeRequired();
        }
    });

    it('keeps the sr-only required marker when there is no visible label', () => {
        renderField({ label: undefined, required: true });
        expect(screen.getByRole('group', { name: 'Required date' })).toBeInTheDocument();
    });

    it('associates help text with the group', () => {
        renderField({ helpText: 'Use the date printed on the licence.' });
        const group = screen.getByRole('group', { name: /Date of Birth/ });
        const describedBy = group.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy)).toHaveTextContent('Use the date printed on the licence.');
    });
});

describe('DateTripletField — emit rules', () => {
    it('does not emit until all three parts are chosen', () => {
        renderField();
        fireEvent.change(selects().month, { target: { value: '3' } });
        expect(onChange).not.toHaveBeenCalled();

        fireEvent.change(selects().year, { target: { value: '1990' } });
        expect(onChange).not.toHaveBeenCalled();

        fireEvent.change(selects().day, { target: { value: '14' } });
        expect(onChange).toHaveBeenCalledWith('dateOfBirth', '1990-03-14');
    });

    it('accepts the parts in any order', () => {
        renderField();
        fireEvent.change(selects().year, { target: { value: '1985' } });
        fireEvent.change(selects().day, { target: { value: '9' } });
        expect(onChange).not.toHaveBeenCalled();

        fireEvent.change(selects().month, { target: { value: '11' } });
        expect(onChange).toHaveBeenCalledWith('dateOfBirth', '1985-11-09');
    });

    it('zero-pads month and day in the emitted ISO value', () => {
        renderField();
        fireEvent.change(selects().year, { target: { value: '2001' } });
        fireEvent.change(selects().month, { target: { value: '2' } });
        fireEvent.change(selects().day, { target: { value: '3' } });
        expect(onChange).toHaveBeenCalledWith('dateOfBirth', '2001-02-03');
    });

    it('clears the parent when a complete date is walked back to incomplete', () => {
        renderField({ value: '1990-03-14' });
        fireEvent.change(selects().day, { target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith('dateOfBirth', '');
    });

    it('clears the parent when every part is cleared through the year', () => {
        renderField({ value: '1990-03-14' });
        fireEvent.change(selects().year, { target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith('dateOfBirth', '');
    });

    it('emits an empty value once every part is cleared again', () => {
        renderField({ value: '' });
        fireEvent.change(selects().month, { target: { value: '5' } });
        expect(onChange).not.toHaveBeenCalled();

        // The all-empty branch reports '' unconditionally — pre-existing behaviour.
        fireEvent.change(selects().month, { target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith('dateOfBirth', '');
    });
});

describe('DateTripletField — hydration from the parent', () => {
    it('shows the parsed parts of an incoming ISO value', () => {
        renderField({ value: '1978-12-31' });
        expect(selects().year).toHaveValue('1978');
        expect(selects().month).toHaveValue('12');
        expect(selects().day).toHaveValue('31');
    });

    it('clears the controls when the parent drops a complete value', () => {
        const { rerender, props } = renderField({ value: '1978-12-31' });
        rerender(<DateTripletField {...props} value="" />);
        expect(selects().year).toHaveValue('');
        expect(selects().month).toHaveValue('');
        expect(selects().day).toHaveValue('');
    });
});

describe('DateTripletField — day clamping', () => {
    it('clamps 31 to 30 for a 30-day month', () => {
        renderField();
        fireEvent.change(selects().year, { target: { value: '1990' } });
        fireEvent.change(selects().month, { target: { value: '1' } });
        fireEvent.change(selects().day, { target: { value: '31' } });
        expect(onChange).toHaveBeenLastCalledWith('dateOfBirth', '1990-01-31');

        fireEvent.change(selects().month, { target: { value: '4' } });
        expect(onChange).toHaveBeenLastCalledWith('dateOfBirth', '1990-04-30');
    });

    it('clamps to 29 for a leap February and 28 otherwise', () => {
        renderField();
        fireEvent.change(selects().year, { target: { value: '2000' } });
        fireEvent.change(selects().month, { target: { value: '1' } });
        fireEvent.change(selects().day, { target: { value: '31' } });
        fireEvent.change(selects().month, { target: { value: '2' } });
        expect(onChange).toHaveBeenLastCalledWith('dateOfBirth', '2000-02-29');

        fireEvent.change(selects().year, { target: { value: '2001' } });
        expect(onChange).toHaveBeenLastCalledWith('dateOfBirth', '2001-02-28');
    });

    it('limits the day options to the selected month length', () => {
        renderField({ value: '1990-02-01' });
        const dayOptions = Array.from(selects().day.options).map((o) => o.value).filter(Boolean);
        expect(dayOptions).toHaveLength(28);
    });
});

describe('DateTripletField — year range', () => {
    it('offers minYear through fifteen years ahead by default', () => {
        renderField();
        const years = Array.from(selects().year.options).map((o) => o.value).filter(Boolean);
        expect(years[0]).toBe('2041');
        expect(years[years.length - 1]).toBe('1920');
    });

    it('honours an explicit minYear and maxYear', () => {
        renderField({ minYear: 2000, maxYear: 2005 });
        const years = Array.from(selects().year.options).map((o) => o.value).filter(Boolean);
        expect(years).toEqual(['2005', '2004', '2003', '2002', '2001', '2000']);
    });

    it('caps the year at today when maxToday is set', () => {
        renderField({ maxToday: true });
        const years = Array.from(selects().year.options).map((o) => o.value).filter(Boolean);
        expect(years[0]).toBe('2026');
    });
});

describe('DateTripletField — maxToday cap', () => {
    it('hides months after the current one in the current year', () => {
        renderField({ maxToday: true, value: '2026-07-01' });
        const months = Array.from(selects().month.options).map((o) => o.value).filter(Boolean);
        expect(months).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    });

    it('limits days to today in the current month', () => {
        renderField({ maxToday: true, value: '2026-07-01' });
        const days = Array.from(selects().day.options).map((o) => o.value).filter(Boolean);
        expect(days[days.length - 1]).toBe('25');
    });

    it('does not cap a past month in the current year', () => {
        renderField({ maxToday: true, value: '2026-06-01' });
        const days = Array.from(selects().day.options).map((o) => o.value).filter(Boolean);
        expect(days).toHaveLength(30);
    });

    it('pulls a later month back to the cap when the year becomes the current year', () => {
        renderField({ maxToday: true });
        fireEvent.change(selects().year, { target: { value: '2020' } });
        fireEvent.change(selects().month, { target: { value: '12' } });
        fireEvent.change(selects().day, { target: { value: '25' } });
        expect(onChange).toHaveBeenLastCalledWith('dateOfBirth', '2020-12-25');

        fireEvent.change(selects().year, { target: { value: '2026' } });
        expect(onChange).toHaveBeenLastCalledWith('dateOfBirth', '2026-07-25');
    });

    it('leaves future dates alone when maxToday is not set', () => {
        renderField();
        fireEvent.change(selects().year, { target: { value: '2030' } });
        fireEvent.change(selects().month, { target: { value: '12' } });
        fireEvent.change(selects().day, { target: { value: '31' } });
        expect(onChange).toHaveBeenLastCalledWith('dateOfBirth', '2030-12-31');
    });
});

describe('DateTripletField — presentation and accessibility', () => {
    it('uses the approved control class and no legacy palette', () => {
        const { container } = renderField({ helpText: 'Artificial help text.', required: true });
        for (const select of Object.values(selects())) {
            expect(select.className).toContain('ds-form-control');
        }
        expect(container.innerHTML).not.toMatch(/border-gray-300|text-gray-700|text-gray-500|focus:ring-blue-500|text-red-500/);
        expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });

    it('uses no unsupported 9px or 10px interface text', () => {
        const { container } = renderField({ helpText: 'Artificial help text.' });
        expect(container.innerHTML).not.toMatch(/text-\[9px\]|text-\[10px\]/);
    });

    it('has no accessibility violations in its default state', async () => {
        const { container } = renderField();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no accessibility violations with help text, required and a value', async () => {
        const { container } = renderField({
            required: true,
            helpText: 'Artificial help text.',
            value: '1990-03-14',
        });
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no accessibility violations without a visible label', async () => {
        const { container } = renderField({ label: undefined, required: true });
        expect((await axe(container)).violations).toEqual([]);
    });
});
