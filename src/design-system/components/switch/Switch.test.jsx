import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

describe('Switch', () => {
  it('announces the switch role and its state, not just a colour', () => {
    render(<Switch checked label="Enable E-Docs for Acme" onChange={vi.fn()} />);
    const control = screen.getByRole('switch', { name: 'Enable E-Docs for Acme' });
    expect(control).toHaveAttribute('aria-checked', 'true');
  });

  it('requires a label naming what it turns on', () => {
    // The Super Admin feature matrix once shipped a grid of these with no name
    // at all: a screen-reader user heard "button" and could not tell which
    // feature it was, which company it belonged to, or whether it was on.
    expect(() => render(<Switch label="" onChange={vi.fn()} />))
      .toThrow(/requires a non-empty label/i);
  });

  it('rejects an unsupported tone', () => {
    expect(() => render(<Switch label="x" tone="chartreuse" onChange={vi.fn()} />))
      .toThrow(/Unsupported Switch tone/i);
  });

  it('toggles on click and reports the value it is moving to', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} label="Enable E-Docs" onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('is operable from the keyboard because it is a real button', () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return <Switch checked={on} label="Enable E-Docs" onChange={setOn} />;
    }
    render(<Harness />);
    const control = screen.getByRole('switch');
    control.focus();
    expect(control).toHaveFocus();
    // A native button activates on both, with no key handler of our own.
    fireEvent.click(control);
    expect(control).toHaveAttribute('aria-checked', 'true');
  });

  it('does not fire when disabled', () => {
    const onChange = vi.fn();
    render(<Switch disabled label="Enable E-Docs" onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has no accessibility violations in either state', async () => {
    const { container } = render(
      <div>
        <Switch checked label="Enable E-Docs" onChange={vi.fn()} />
        <Switch checked={false} tone="danger" label="Restrict exports" onChange={vi.fn()} />
      </div>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
