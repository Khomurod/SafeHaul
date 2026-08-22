import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { Disclosure } from './Disclosure';

describe('Disclosure', () => {
  it('puts the trigger inside a heading so the section is in the outline', () => {
    // A button containing a heading is not a heading. The rail's sections have
    // to be navigable by heading whether they are open or closed.
    render(<Disclosure title="Signature fields">Body</Disclosure>);
    const heading = screen.getByRole('heading', { level: 3, name: /Signature fields/ });
    expect(heading.querySelector('button')).toBeInTheDocument();
  });

  it('matches the surrounding outline when asked', () => {
    render(<Disclosure title="Signature fields" headingLevel={2}>Body</Disclosure>);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('rejects a heading level that is not one', () => {
    expect(() => render(<Disclosure title="x" headingLevel={7}>b</Disclosure>))
      .toThrow(/Unsupported Disclosure headingLevel/i);
  });

  it('requires a title', () => {
    expect(() => render(<Disclosure title="   ">Body</Disclosure>))
      .toThrow(/requires a non-empty title/i);
  });

  it('announces its state through aria-expanded, not the chevron', () => {
    render(<Disclosure title="Signature fields" defaultOpen>Body</Disclosure>);
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
  });

  it('opens and closes uncontrolled', () => {
    render(<Disclosure title="Signature fields">Body</Disclosure>);
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Body')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
  });

  it('unmounts its content when closed rather than hiding it', () => {
    // `hidden` would leave a focus target inside a collapsed section reachable
    // by find-in-page and by screen-reader browse mode.
    const { container } = render(<Disclosure title="Signature fields"><button type="button">Inside</button></Disclosure>);
    expect(container.querySelector('button[type="button"]:not(.ds-disclosure__trigger)')).toBeNull();
  });

  it('lets a controlled owner decide, and reports the value it is moving to', () => {
    const onToggle = vi.fn();
    render(<Disclosure title="Signature fields" open={false} onToggle={onToggle}>Body</Disclosure>);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledWith(true);
    // Controlled: it does not move on its own.
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
  });

  it('links the trigger to the panel it controls', () => {
    const { container } = render(<Disclosure title="Signature fields" defaultOpen>Body</Disclosure>);
    const trigger = screen.getByRole('button');
    const panel = container.querySelector('.ds-disclosure__panel');
    expect(trigger).toHaveAttribute('aria-controls', panel.id);
  });

  it('allows several to be open at once, unlike a tab strip', () => {
    // This is the property `EnvelopeSidebar` chose a disclosure over tabs for.
    function Harness() {
      const [open, setOpen] = useState({ a: true, b: true });
      return (
        <>
          <Disclosure title="Section A" open={open.a} onToggle={(v) => setOpen((s) => ({ ...s, a: v }))}>Body A</Disclosure>
          <Disclosure title="Section B" open={open.b} onToggle={(v) => setOpen((s) => ({ ...s, b: v }))}>Body B</Disclosure>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByText('Body A')).toBeInTheDocument();
    expect(screen.getByText('Body B')).toBeInTheDocument();
  });

  it('has no accessibility violations open or closed', async () => {
    const { container } = render(
      <div>
        <Disclosure title="Open section" defaultOpen>Body</Disclosure>
        <Disclosure title="Closed section">Body</Disclosure>
      </div>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
