import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Chip, ChipGroup } from './Chip';
import { Phone } from '../../icons';

describe('Chip', () => {
    it('renders a button by default and calls onClick', () => {
        const onClick = vi.fn();
        render(<Chip onClick={onClick}>Hired</Chip>);
        const chip = screen.getByRole('button', { name: 'Hired' });
        expect(chip).toHaveAttribute('type', 'button');
        fireEvent.click(chip);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('omits aria-pressed entirely when the chip is not a toggle', () => {
        render(<Chip>Hired</Chip>);
        expect(screen.getByRole('button', { name: 'Hired' })).not.toHaveAttribute('aria-pressed');
    });

    it('reports both toggle states, and marks pressed in the DOM for CSS', () => {
        const { rerender } = render(<Chip pressed={false}>Hired</Chip>);
        const off = screen.getByRole('button', { name: 'Hired' });
        expect(off).toHaveAttribute('aria-pressed', 'false');
        expect(off).not.toHaveAttribute('data-pressed');

        rerender(<Chip pressed>Hired</Chip>);
        const on = screen.getByRole('button', { name: 'Hired' });
        expect(on).toHaveAttribute('aria-pressed', 'true');
        expect(on).toHaveAttribute('data-pressed', 'true');
    });

    /*
     * The check is what makes selection more than a colour. A pressed chip that
     * renders no glyph is the failure this test exists to catch, because it
     * looks correct on a colour screen.
     */
    it('draws a leading check when pressed, and none when not', () => {
        const { container, rerender } = render(<Chip>Hired</Chip>);
        expect(container.querySelectorAll('svg')).toHaveLength(0);
        rerender(<Chip pressed>Hired</Chip>);
        expect(container.querySelectorAll('svg')).toHaveLength(1);
    });

    it('keeps its own glyph beside the check rather than replacing it', () => {
        const { container } = render(<Chip icon={Phone} pressed>Call</Chip>);
        expect(container.querySelectorAll('svg')).toHaveLength(2);
    });

    it('renders an anchor when given an href, with no button semantics', () => {
        render(<Chip href="tel:+15551234567">(555) 123-4567</Chip>);
        const link = screen.getByRole('link', { name: '(555) 123-4567' });
        expect(link).toHaveAttribute('href', 'tel:+15551234567');
        expect(link).not.toHaveAttribute('type');
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('opens an external link safely', () => {
        render(<Chip href="https://example.com" external>Docs</Chip>);
        const link = screen.getByRole('link', { name: 'Docs' });
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('refuses to be both a link and a toggle', () => {
        expect(() => render(<Chip href="/x" pressed>Both</Chip>))
            .toThrow(/cannot be both a link and a toggle/);
    });

    it('refuses `external` without an href', () => {
        expect(() => render(<Chip external>Nowhere</Chip>))
            .toThrow(/only means something with an `href`/);
    });

    it('refuses an unsupported tone or size, naming what it accepts', () => {
        expect(() => render(<Chip tone="brand">x</Chip>)).toThrow(/Unsupported Chip tone: brand/);
        expect(() => render(<Chip size="lg">x</Chip>)).toThrow(/Unsupported Chip size: lg/);
    });

    it('puts the tone and size on the element for CSS, and omits a default tone', () => {
        const { container, rerender } = render(<Chip>Plain</Chip>);
        expect(container.firstChild).not.toHaveAttribute('data-tone');
        expect(container.firstChild).toHaveAttribute('data-size', 'xs');
        rerender(<Chip tone="success" size="sm">Toned</Chip>);
        expect(container.firstChild).toHaveAttribute('data-tone', 'success');
        expect(container.firstChild).toHaveAttribute('data-size', 'sm');
    });

    it('forwards a ref and keeps caller class names', () => {
        const ref = { current: null };
        const { container } = render(<Chip ref={ref} className="mt-2">x</Chip>);
        expect(ref.current).toBe(container.firstChild);
        expect(container.firstChild).toHaveClass('ds-chip', 'mt-2');
    });

    it('has no axe violations as a pressed group', async () => {
        const { container } = render(
            <ChipGroup ariaLabel="Status">
                <Chip pressed>Hired</Chip>
                <Chip pressed={false}>Rejected</Chip>
            </ChipGroup>,
        );
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('ChipGroup', () => {
    it('names the group with aria-label', () => {
        render(<ChipGroup ariaLabel="Status"><Chip>Hired</Chip></ChipGroup>);
        expect(screen.getByRole('group', { name: 'Status' })).toBeInTheDocument();
    });

    it('prefers a visible label and does not set both names', () => {
        render(
            <>
                <span id="status-label">Status</span>
                <ChipGroup ariaLabel="Ignored" ariaLabelledBy="status-label">
                    <Chip>Hired</Chip>
                </ChipGroup>
            </>,
        );
        const group = screen.getByRole('group', { name: 'Status' });
        expect(group).not.toHaveAttribute('aria-label');
    });

    it('refuses an unnamed group, because "pressed" alone does not say what was chosen', () => {
        expect(() => render(<ChipGroup><Chip>Hired</Chip></ChipGroup>))
            .toThrow(/requires an ariaLabel or ariaLabelledBy/);
        expect(() => render(<ChipGroup ariaLabel="   "><Chip>Hired</Chip></ChipGroup>))
            .toThrow(/requires an ariaLabel or ariaLabelledBy/);
    });
});
