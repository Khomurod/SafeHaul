import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { SelectableCard } from './SelectableCard';

describe('SelectableCard', () => {
    it('is a button by default and calls onSelect', () => {
        const onSelect = vi.fn();
        render(<SelectableCard onSelect={onSelect}>Acme Freight</SelectableCard>);
        const card = screen.getByRole('button', { name: 'Acme Freight' });
        expect(card).toHaveAttribute('type', 'button');
        fireEvent.click(card);
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    /*
     * The three states the four migrated sites carried between them. A plain
     * activation — the company chooser — must announce NEITHER, or a screen
     * reader calls a navigation control a toggle.
     */
    it('says nothing about state unless asked', () => {
        render(<SelectableCard onSelect={() => {}}>Acme Freight</SelectableCard>);
        const card = screen.getByRole('button', { name: 'Acme Freight' });
        expect(card).not.toHaveAttribute('aria-pressed');
        expect(card).not.toHaveAttribute('aria-current');
        expect(card).not.toHaveAttribute('data-state');
    });

    it('reports both selected states, and marks only the on one for CSS', () => {
        const { rerender } = render(<SelectableCard selected={false}>Row</SelectableCard>);
        const off = screen.getByRole('button', { name: 'Row' });
        expect(off).toHaveAttribute('aria-pressed', 'false');
        expect(off).not.toHaveAttribute('data-state');

        rerender(<SelectableCard selected>Row</SelectableCard>);
        const on = screen.getByRole('button', { name: 'Row' });
        expect(on).toHaveAttribute('aria-pressed', 'true');
        expect(on).toHaveAttribute('data-state', 'on');
    });

    it('marks the current one of a set, and never says current="false"', () => {
        const { rerender } = render(<SelectableCard current={false}>Page 3</SelectableCard>);
        expect(screen.getByRole('button', { name: 'Page 3' })).not.toHaveAttribute('aria-current');
        rerender(<SelectableCard current>Page 3</SelectableCard>);
        const on = screen.getByRole('button', { name: 'Page 3' });
        expect(on).toHaveAttribute('aria-current', 'page');
        expect(on).toHaveAttribute('data-state', 'on');
        expect(on).not.toHaveAttribute('aria-pressed');
    });

    /*
     * They answer different questions — "is this one on" and "is this the one
     * you are on" — and an element asserting both tells assistive technology two
     * stories about itself.
     */
    it('refuses to be both selected and current', () => {
        expect(() => render(<SelectableCard selected current>Both</SelectableCard>))
            .toThrow(/cannot be both `selected` and `current`/);
    });

    it('renders the non-interactive twin, with no button semantics', () => {
        render(<SelectableCard as="div">Already messaged</SelectableCard>);
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByText('Already messaged')).toBeInTheDocument();
    });

    /*
     * A caller asking for state or a handler on a `div` wants a control and has
     * spelled it wrong. Dropping the handler silently would give them a card
     * that looks clickable and is not.
     */
    it('refuses state or a handler on the non-interactive twin', () => {
        expect(() => render(<SelectableCard as="div" selected>x</SelectableCard>))
            .toThrow(/takes no state and no `onSelect`/);
        expect(() => render(<SelectableCard as="div" onSelect={() => {}}>x</SelectableCard>))
            .toThrow(/takes no state and no `onSelect`/);
    });

    it('refuses an element it has no rules for', () => {
        expect(() => render(<SelectableCard as="li">x</SelectableCard>))
            .toThrow(/Unsupported SelectableCard element: li/);
    });

    it('refuses an unsupported padding or surface, naming what it got', () => {
        expect(() => render(<SelectableCard padding="huge">x</SelectableCard>))
            .toThrow(/Unsupported SelectableCard padding: huge/);
        expect(() => render(<SelectableCard surface="dark">x</SelectableCard>))
            .toThrow(/Unsupported SelectableCard surface: dark/);
    });

    it('puts padding and surface on the element, and omits the default surface', () => {
        const { container, rerender } = render(<SelectableCard>x</SelectableCard>);
        expect(container.firstChild).toHaveAttribute('data-padding', 'sm');
        expect(container.firstChild).not.toHaveAttribute('data-surface');
        rerender(<SelectableCard surface="inverse" padding="xs">x</SelectableCard>);
        expect(container.firstChild).toHaveAttribute('data-surface', 'inverse');
        expect(container.firstChild).toHaveAttribute('data-padding', 'xs');
    });

    it('forwards a ref and keeps caller class names', () => {
        const ref = { current: null };
        const { container } = render(<SelectableCard ref={ref} className="mb-2">x</SelectableCard>);
        expect(ref.current).toBe(container.firstChild);
        expect(container.firstChild).toHaveClass('ds-selectable-card', 'mb-2');
    });

    it('has no axe violations in either state', async () => {
        const { container } = render(
            <ul style={{ listStyle: 'none' }}>
                <li><SelectableCard selected>Chosen</SelectableCard></li>
                <li><SelectableCard selected={false}>Not chosen</SelectableCard></li>
                <li><SelectableCard current>Current page</SelectableCard></li>
                <li><SelectableCard as="div">Not a control</SelectableCard></li>
            </ul>,
        );
        expect((await axe(container)).violations).toEqual([]);
    });
});
