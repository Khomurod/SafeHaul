import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

/** An icon-only link that names itself, as a folded menu item does. */
function Item({ disabled = false }) {
  return (
    <nav aria-label="Menu" style={{ overflow: 'hidden' }}>
      <Tooltip label="Campaigns" disabled={disabled}>
        <a href="/campaigns" aria-label="Campaigns">
          <svg aria-hidden="true" />
        </a>
      </Tooltip>
    </nav>
  );
}

const label = () => document.body.querySelector('.ds-tooltip');

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function box() {
    return this.tagName === 'A'
      ? { left: 8, right: 56, top: 100, bottom: 140, width: 48, height: 40, x: 8, y: 100, toJSON() {} }
      : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Tooltip', () => {
  it('shows the label beside its control on hover, outside any container that could clip it', () => {
    render(<Item />);
    expect(label()).toBeNull();

    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Campaigns' }));
    expect(label()).toHaveTextContent('Campaigns');
    // On the body, not inside the clipped menu, and 8px right of the control's middle.
    expect(label().parentElement).toBe(document.body);
    expect(label()).toHaveStyle({ left: '64px', top: '120px' });
  });

  it('is drawn, never announced: the control carries the name once', async () => {
    const { container } = render(<Item />);
    fireEvent.mouseEnter(screen.getByRole('link'));
    expect(label()).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('link')).toHaveAccessibleName('Campaigns');
    vi.useRealTimers();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('stays while the pointer crosses onto it, and goes once the pointer has left both', () => {
    render(<Item />);
    const link = screen.getByRole('link');
    fireEvent.mouseEnter(link);
    fireEvent.mouseLeave(link);
    // The pointer reaches the label before the delay runs out.
    fireEvent.mouseEnter(label());
    act(() => { vi.advanceTimersByTime(500); });
    expect(label()).not.toBeNull();

    fireEvent.mouseLeave(label());
    act(() => { vi.advanceTimersByTime(200); });
    expect(label()).toBeNull();
  });

  it('shows on keyboard focus and goes on blur', () => {
    render(<Item />);
    const link = screen.getByRole('link');
    act(() => { link.focus(); });
    expect(link).toHaveFocus();
    expect(label()).toHaveTextContent('Campaigns');
    act(() => { link.blur(); });
    expect(label()).toBeNull();
  });

  it('is dismissed with Escape', () => {
    render(<Item />);
    fireEvent.mouseEnter(screen.getByRole('link'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(label()).toBeNull();
  });

  it('shows nothing while disabled, leaves when switched off while shown, and keeps the control', () => {
    const { rerender } = render(<Item />);
    const link = screen.getByRole('link');
    fireEvent.mouseEnter(link);
    expect(label()).not.toBeNull();

    rerender(<Item disabled />);
    expect(label()).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('link'));
    expect(label()).toBeNull();
    // The same element: switching never remounts the control.
    expect(screen.getByRole('link')).toBe(link);
  });

  it('wraps nothing: the control stays its parent\'s child, so the parent\'s spacing still reaches it', () => {
    render(<Item />);
    expect(screen.getByRole('link').parentElement).toBe(screen.getByRole('navigation'));
  });

  it('keeps the control\'s own handlers and ref', () => {
    const onMouseEnter = vi.fn();
    const ref = React.createRef();
    render(
      <Tooltip label="Settings">
        <a href="/settings" aria-label="Settings" ref={ref} onMouseEnter={onMouseEnter}>s</a>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole('link'));
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(ref.current).toBe(screen.getByRole('link'));
    expect(label()).toHaveTextContent('Settings');
  });

  it('refuses a missing label, and anything but one element', () => {
    expect(() => render(
      <Tooltip label=" "><a href="/x" aria-label="X">x</a></Tooltip>,
    )).toThrow(/Tooltip requires a label/);
    expect(() => render(<Tooltip label="X">text</Tooltip>)).toThrow(/Tooltip wraps one element/);
  });
});
