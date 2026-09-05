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

  describe('variant="card"', () => {
    it('keeps the same trigger-inside-a-heading shape as the rail', () => {
      // The appearance changes; the structure that makes it a disclosure does
      // not. This is also what `hand-rolled-disclosure` reads for, so a rewrite
      // that moved the button out of the heading would silently make the guard
      // stop covering the thing it was written for.
      render(
        <Disclosure variant="card" title="How to set up delivery" description="Three providers">
          Body
        </Disclosure>,
      );
      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading.querySelector('button')).toHaveAttribute('aria-expanded', 'false');
    });

    it('reads the description as part of the trigger name, as the hand-built one did', () => {
      // Deliberately unchanged from the markup this replaced: the whole header
      // is one control, so everything visible in it is in its name. Written
      // down because a consumer choosing a description is choosing a name.
      render(
        <Disclosure variant="card" title="How to set up delivery" description="Three providers">
          Body
        </Disclosure>,
      );
      expect(screen.getByRole('button', { name: 'How to set up delivery Three providers' }))
        .toBeInTheDocument();
    });

    it('hides the leading slot from assistive technology by construction', () => {
      // The wrapper carries `aria-hidden`, not the caller. A slot that trusts
      // every consumer to remember is a slot that gets it wrong once.
      render(
        <Disclosure variant="card" title="Guide" leading={<span>TILE</span>}>Body</Disclosure>,
      );
      expect(screen.getByText('TILE').closest('[aria-hidden="true"]')).not.toBeNull();
      expect(screen.getByRole('button')).toHaveAccessibleName('Guide');
    });

    it('refuses a description on the rail, which has nowhere to put one', () => {
      expect(() => render(<Disclosure title="Fields" description="x">Body</Disclosure>))
        .toThrow(/description requires variant="card"/i);
    });

    it('refuses a leading slot on the rail', () => {
      expect(() => render(<Disclosure title="Fields" leading={<span />}>Body</Disclosure>))
        .toThrow(/leading requires variant="card"/i);
    });

    it('refuses meta on a card, where it would fight the chevron for one slot', () => {
      expect(() => render(<Disclosure variant="card" title="Guide" meta="3">Body</Disclosure>))
        .toThrow(/meta is not supported by variant="card"/i);
    });

    it('refuses a blank description rather than rendering an empty line', () => {
      expect(() => render(<Disclosure variant="card" title="Guide" description="  ">B</Disclosure>))
        .toThrow(/description must be a non-empty string/i);
    });

    it('rejects a variant it does not have', () => {
      expect(() => render(<Disclosure variant="panel" title="Guide">Body</Disclosure>))
        .toThrow(/Unsupported Disclosure variant/i);
    });

    it('leaves the rail markup untouched, so its baseline cannot move', () => {
      // Every card rule is scoped under `[data-variant='card']`, and the rail
      // renders no `data-variant` at all. Asserted rather than assumed: this is
      // the one property that makes the variant a zero-risk addition to a
      // component that already has a committed pixel baseline.
      const { container } = render(<Disclosure title="Signature fields">Body</Disclosure>);
      expect(container.querySelector('.ds-disclosure')).not.toHaveAttribute('data-variant');
      expect(container.querySelector('.ds-disclosure__text')).toBeNull();
      expect(container.querySelector('.ds-disclosure__description')).toBeNull();
      expect(container.querySelector('.ds-disclosure__leading')).toBeNull();
    });
  });
});
