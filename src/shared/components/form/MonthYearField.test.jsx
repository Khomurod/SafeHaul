/**
 * `MonthYearField` contract: the `${idPrefix}-month|year` element ids, the
 * partial-selection emit rules, the `maxToday` month cap, and the grouped
 * accessible naming added by the design-system migration.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MonthYearField from './MonthYearField';

const renderField = (props = {}) => {
  const onChange = props.onChange || vi.fn();
  const utils = render(
    <MonthYearField
      label="Gap Start (month / year)"
      idPrefix="unemp-start-0"
      name="startDate"
      value=""
      onChange={onChange}
      {...props}
    />,
  );
  return { ...utils, onChange };
};

const monthSelect = () => document.getElementById('unemp-start-0-month');
const yearSelect = () => document.getElementById('unemp-start-0-year');

describe('MonthYearField element contract', () => {
  it('keeps the frozen month and year element ids', () => {
    renderField();
    expect(monthSelect()).not.toBeNull();
    expect(yearSelect()).not.toBeNull();
  });

  it('emits nothing until both parts are chosen, then emits YYYY-MM', () => {
    const { onChange } = renderField();

    fireEvent.change(monthSelect(), { target: { value: '3' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(yearSelect(), { target: { value: '2019' } });
    expect(onChange).toHaveBeenCalledWith('startDate', '2019-03');
  });

  it('clears the parent value when a complete selection goes back to partial', () => {
    const { onChange } = renderField({ value: '2019-03' });

    fireEvent.change(monthSelect(), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('startDate', '');
  });

  it('emits an empty value when the year is cleared', () => {
    const { onChange } = renderField({ value: '2019-03' });

    fireEvent.change(yearSelect(), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('startDate', '');
  });

  it('caps the month list at the current month for the current year under maxToday', () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    renderField({ maxToday: true, value: `${currentYear}-01` });

    const options = [...monthSelect().querySelectorAll('option')].filter((o) => o.value !== '');
    expect(options).toHaveLength(currentMonth);
  });

  it('offers years from the computed max down to minYear', () => {
    renderField({ minYear: 2020, maxYear: 2022 });
    const options = [...yearSelect().querySelectorAll('option')].filter((o) => o.value !== '');
    expect(options.map((o) => o.value)).toEqual(['2022', '2021', '2020']);
  });

  it('reflects an externally cleared value back into the UI', () => {
    function Harness() {
      const [value, setValue] = useState('2019-03');
      return (
        <>
          <MonthYearField
            label="Gap Start (month / year)"
            idPrefix="unemp-start-0"
            name="startDate"
            value={value}
            onChange={(_, v) => setValue(v)}
          />
          <button type="button" onClick={() => setValue('')}>reset</button>
        </>
      );
    }
    render(<Harness />);
    expect(yearSelect()).toHaveValue('2019');

    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(yearSelect()).toHaveValue('');
    expect(monthSelect()).toHaveValue('');
  });
});

describe('MonthYearField accessible naming', () => {
  it('groups both selects under the field label instead of announcing bare "Month"', () => {
    renderField({ required: true, helpText: 'Easier than typing.' });

    const group = screen.getByRole('group', { name: /Gap Start \(month \/ year\) required/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByLabelText('Gap Start (month / year) month')).toBe(monthSelect());
    expect(screen.getByLabelText('Gap Start (month / year) year')).toBe(yearSelect());
  });

  it('associates help text with the group', () => {
    renderField({ helpText: 'Easier than typing.' });
    const group = screen.getByRole('group');
    const describedBy = group.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy)).toHaveTextContent('Easier than typing.');
  });

  it('marks both controls required so the browser enforces the pair', () => {
    renderField({ required: true });
    expect(monthSelect()).toBeRequired();
    expect(yearSelect()).toBeRequired();
  });
});
