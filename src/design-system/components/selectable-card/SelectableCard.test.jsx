import { readFileSync } from 'node:fs';
import path from 'node:path';
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

/*
 * `frame="row"`: the rows of ONE card (C2 settings menu) — the card draws the
 * box and the list draws the dividers, so a row has no box of its own.
 */
describe('SelectableCard frame="row"', () => {
    it('marks a row for CSS and leaves the default card unmarked', () => {
        const { container, rerender } = render(<SelectableCard>x</SelectableCard>);
        expect(container.firstChild).not.toHaveAttribute('data-frame');
        rerender(<SelectableCard frame="row">x</SelectableCard>);
        expect(container.firstChild).toHaveAttribute('data-frame', 'row');
    });

    it('stays a button named by its content, and keeps its states', () => {
        const onSelect = vi.fn();
        const { rerender } = render(
            <SelectableCard frame="row" onSelect={onSelect}>
                <span>Team</span> <span>Who recruits for you</span>
            </SelectableCard>,
        );
        const row = screen.getByRole('button', { name: 'Team Who recruits for you' });
        expect(row).not.toHaveAttribute('aria-pressed');
        fireEvent.click(row);
        expect(onSelect).toHaveBeenCalledTimes(1);
        rerender(<SelectableCard frame="row" current>Team</SelectableCard>);
        expect(screen.getByRole('button', { name: 'Team' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Team' })).toHaveAttribute('data-state', 'on');
    });

    it('refuses a frame it has no rules for', () => {
        expect(() => render(<SelectableCard frame="tile">x</SelectableCard>))
            .toThrow(/Unsupported SelectableCard frame: tile/);
    });

    /* Both only colour or swap the box a row does not have: refused, not ignored. */
    it('refuses a tone or the inverse surface on a row', () => {
        expect(() => render(<SelectableCard frame="row" tone="warning">x</SelectableCard>))
            .toThrow(/frame="row" has no border of its own/);
        expect(() => render(<SelectableCard frame="row" surface="inverse">x</SelectableCard>))
            .toThrow(/frame="row" has no border of its own/);
    });

    it('has no axe violations as the rows of one list', async () => {
        const { container } = render(
            <section aria-label="Messaging">
                <ul className="ds-card" style={{ listStyle: 'none' }}>
                    <li><SelectableCard frame="row" onSelect={() => {}}>Email</SelectableCard></li>
                    <li><SelectableCard frame="row" current>Text messages</SelectableCard></li>
                    <li><SelectableCard frame="row" as="div">Not a control</SelectableCard></li>
                </ul>
            </section>,
        );
        expect((await axe(container)).violations).toEqual([]);
    });
});

/* jsdom lays nothing out; the selected treatment is pinned as a rule. */
describe('SelectableCard selected treatment', () => {
    const css = readFileSync(path.join(__dirname, 'SelectableCard.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    it('fills a chosen card with the selected-surface tint, not a status tint', () => {
        const on = css.slice(css.indexOf(".ds-selectable-card[data-state='on'] {"));
        const rule = on.slice(0, on.indexOf('}'));
        expect(rule).toMatch(/background:\s*var\(--ds-color-surface-selected\)/);
        expect(rule).toMatch(/border-color:\s*var\(--ds-color-action-primary\)/);
        expect(rule).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--ds-color-action-primary\)/);
        expect(css).not.toMatch(/--ds-color-status-info-bg/);
    });

    it('keeps the choice visible in forced colours', () => {
        expect(css).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.ds-selectable-card\[data-state='on'\]\s*\{\s*border-color:\s*Highlight/);
        // A row has no border to recolour: its choice is a Highlight outline.
        expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*\[data-frame='row'\]\[data-state='on'\]\s*\{\s*outline:\s*2px solid Highlight/);
    });

    const rule = (selector) => {
        const start = css.indexOf(`${selector} {`);
        return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
    };

    it('draws a row with no box of its own, on its card\'s surface', () => {
        const row = rule(".ds-selectable-card[data-frame='row']");
        expect(row).toMatch(/border:\s*0/);
        expect(row).toMatch(/border-radius:\s*0/);
        expect(row).toMatch(/--ds-selectable-bg:\s*transparent/);
    });

    it('fills a row under the pointer and rings it inside its own edge', () => {
        expect(rule("button.ds-selectable-card[data-frame='row']:hover:not(:disabled):not([data-state])"))
            .toMatch(/background:\s*var\(--ds-color-surface-hover\)/);
        expect(rule(".ds-selectable-card[data-frame='row']:focus-visible")).toMatch(/outline-offset:\s*-2px/);
        expect(rule(".ds-selectable-card[data-frame='row'][data-state='on']"))
            .toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--ds-color-action-primary\)/);
    });

    it('rounds the first and last row to the card\'s inner corner, so fill and ring follow it', () => {
        expect(rule("li:first-child > .ds-selectable-card[data-frame='row']"))
            .toMatch(/border-start-start-radius:\s*calc\(var\(--ds-card-radius\) - 1px\)/);
        expect(rule("li:last-child > .ds-selectable-card[data-frame='row']"))
            .toMatch(/border-end-end-radius:\s*calc\(var\(--ds-card-radius\) - 1px\)/);
    });
});
