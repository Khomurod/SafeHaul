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
    // A switch with no name: a screen-reader user hears "button" and cannot
    // tell which feature it is, which company it belongs to, or whether it is on.
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

  describe('with showLabel', () => {
    it('prints the label beside the switch and takes its name from it', () => {
      render(<Switch showLabel label="Only mine" onChange={vi.fn()} />);

      const control = screen.getByRole('switch', { name: 'Only mine' });
      expect(control).not.toHaveAttribute('aria-label');
      expect(screen.getByText('Only mine').tagName).toBe('LABEL');
      expect(screen.getByText('Only mine')).toHaveAttribute('for', control.id);
    });

    it('moves the switch when the words are pressed', () => {
      const onChange = vi.fn();
      render(<Switch showLabel checked={false} label="Only mine" onChange={onChange} />);

      fireEvent.click(screen.getByText('Only mine'));

      expect(onChange).toHaveBeenCalledWith(true);
    });

    it('does not move when disabled, by the switch or by the words', () => {
      const onChange = vi.fn();
      render(<Switch showLabel disabled label="Only mine" onChange={onChange} />);

      fireEvent.click(screen.getByText('Only mine'));
      fireEvent.click(screen.getByRole('switch'));

      expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps an id the caller gives it', () => {
      render(<Switch showLabel id="only-mine" label="Only mine" onChange={vi.fn()} />);

      expect(screen.getByRole('switch', { name: 'Only mine' })).toHaveAttribute('id', 'only-mine');
    });

    it('puts className on the pair, so a toolbar places both together', () => {
      const { container } = render(<Switch showLabel className="toolbar-slot" label="Only mine" onChange={vi.fn()} />);

      expect(container.firstChild).toHaveClass('ds-switch-field', 'toolbar-slot');
      expect(screen.getByRole('switch')).not.toHaveClass('toolbar-slot');
    });

    it('has no accessibility violations', async () => {
      const { container } = render(
        <div>
          <Switch showLabel checked label="Only mine" onChange={vi.fn()} />
          <Switch showLabel disabled label="Archived too" onChange={vi.fn()} />
        </div>,
      );
      expect((await axe(container)).violations).toEqual([]);
    });
  });
});
