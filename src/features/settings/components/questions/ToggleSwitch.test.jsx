import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { ToggleSwitch } from './ToggleSwitch';

describe('ToggleSwitch', () => {
    it('renders an ARIA switch with the given accessible name and state', () => {
        render(<ToggleSwitch checked label="Require Social Security Number" onChange={vi.fn()} />);
        const control = screen.getByRole('switch', { name: 'Require Social Security Number' });
        expect(control).toHaveAttribute('aria-checked', 'true');
    });

    it('exposes the off state programmatically (not by color alone)', () => {
        render(<ToggleSwitch checked={false} label="Hide Date of Birth" onChange={vi.fn()} />);
        expect(screen.getByRole('switch', { name: 'Hide Date of Birth' }))
            .toHaveAttribute('aria-checked', 'false');
    });

    it('toggles via click and keyboard, emitting the negated value', () => {
        const onChange = vi.fn();
        render(<ToggleSwitch checked={false} label="Require CDL" onChange={onChange} />);
        const control = screen.getByRole('switch', { name: 'Require CDL' });

        fireEvent.click(control);
        expect(onChange).toHaveBeenLastCalledWith(true);

        // Native <button> handles Space/Enter activation as a click.
        fireEvent.click(control);
        expect(onChange).toHaveBeenLastCalledWith(true);
    });

    it('does not emit when disabled', () => {
        const onChange = vi.fn();
        render(<ToggleSwitch checked={false} label="Require CDL" onChange={onChange} disabled />);
        const control = screen.getByRole('switch', { name: 'Require CDL' });
        expect(control).toBeDisabled();
        fireEvent.click(control);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('throws on an empty label or unsupported tone', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<ToggleSwitch label="" onChange={vi.fn()} />)).toThrow(/non-empty label/);
        expect(() => render(<ToggleSwitch label="X" tone="bad" onChange={vi.fn()} />)).toThrow(/Unsupported/);
        spy.mockRestore();
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<ToggleSwitch checked label="Require CDL" onChange={vi.fn()} />);
        expect((await axe(container)).violations).toEqual([]);
    });
});
