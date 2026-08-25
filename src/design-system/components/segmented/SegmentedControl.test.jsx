import React, { useState } from 'react';
import { CheckCircle, Clock } from 'lucide-react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { value: 'interested', label: 'Connected / Interested', icon: CheckCircle, tone: 'success' },
  { value: 'callback', label: 'Scheduled Callback', icon: Clock, tone: 'info' },
  { value: 'no_answer', label: 'No Answer', tone: 'danger' },
];

function Harness({ initial = null }) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedControl
      ariaLabel="Call outcome"
      options={OPTIONS}
      value={value}
      onChange={setValue}
      columns={2}
    />
  );
}

describe('SegmentedControl', () => {
  it('names the choice, because "pressed" alone does not say what was chosen', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Call outcome' })).toBeInTheDocument();
  });

  it('refuses a group with no name', () => {
    expect(() => render(<SegmentedControl options={OPTIONS} value={null} onChange={vi.fn()} />))
      .toThrow(/requires an ariaLabel/i);
  });

  it('refuses an empty group', () => {
    expect(() => render(<SegmentedControl ariaLabel="x" options={[]} value={null} onChange={vi.fn()} />))
      .toThrow(/at least one option/i);
  });

  it('rejects an unsupported tone rather than rendering an untoned option', () => {
    expect(() => render(
      <SegmentedControl ariaLabel="x" options={[{ value: 'a', label: 'A', tone: 'chartreuse' }]} value={null} onChange={vi.fn()} />,
    )).toThrow(/Unsupported SegmentedControl tone/i);
  });

  it('exposes selection through aria-pressed', () => {
    render(<Harness initial="callback" />);
    expect(screen.getByRole('button', { name: 'Scheduled Callback', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No Answer', pressed: false })).toBeInTheDocument();
  });

  it('selects exactly one option at a time', () => {
    render(<Harness initial="callback" />);
    fireEvent.click(screen.getByRole('button', { name: 'No Answer' }));
    const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAccessibleName('No Answer');
  });

  it('keeps every option individually tabbable', () => {
    // The deliberate difference from a radiogroup: no roving focus, so Tab
    // reaches each card. All four call sites already behave this way, and two
    // sit inside forms where the arrow keys already mean something else.
    render(<Harness initial="callback" />);
    for (const option of screen.getAllByRole('button')) {
      expect(option).not.toHaveAttribute('tabindex', '-1');
    }
  });

  it('does not fire for a disabled option', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Call outcome"
        options={[{ value: 'a', label: 'Unavailable', disabled: true }]}
        value={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unavailable' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Harness initial="interested" />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
