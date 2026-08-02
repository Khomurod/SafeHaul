/**
 * Contract freeze + a11y proof for `ToastProvider`, written with its visual
 * migration (2026-07-28) — the roadmap's "Toast/notification" row.
 *
 * Every feature in the app calls this provider, so the public API is the thing
 * most worth freezing. Frozen here: the four `show*` helpers and the severity
 * value each one sends, the default 4000 ms auto-dismiss, manual dismissal, the
 * `role="alert"` announcement, the `Dismiss notification: {message}` control
 * name, stacking order, and the fact that the surface renders its children
 * untouched.
 *
 * The migration changes only presentation (semantic status tokens instead of nine
 * legacy palette classes, an approved `IconButton` instead of a hand-rolled 28 px
 * box, a viewport-safe stack) plus one additive accessibility fix: the severity
 * is now announced before the message.
 */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider, useToast } from './ToastProvider';

function Harness() {
    const { showSuccess, showError, showInfo, showWarning } = useToast();
    return (
        <div>
            <p>child content</p>
            <button type="button" onClick={() => showSuccess('Saved successfully!')}>fire success</button>
            <button type="button" onClick={() => showError('Something broke')}>fire error</button>
            <button type="button" onClick={() => showInfo('Heads up')}>fire info</button>
            <button type="button" onClick={() => showWarning('Careful')}>fire warning</button>
        </div>
    );
}

function renderProvider() {
    return render(<ToastProvider><Harness /></ToastProvider>);
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('ToastProvider — public API', () => {
    it('renders its children untouched', () => {
        renderProvider();
        expect(screen.getByText('child content')).toBeInTheDocument();
    });

    it('throws a clear error when useToast is used outside the provider', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<Harness />)).toThrow('useToast must be used within a ToastProvider');
    });

    it.each([
        ['fire success', 'Saved successfully!', 'Success'],
        ['fire error', 'Something broke', 'Error'],
        ['fire info', 'Heads up', 'Information'],
        ['fire warning', 'Careful', 'Warning'],
    ])('%s shows the message as an alert with its severity announced', (trigger, message, severity) => {
        renderProvider();
        fireEvent.click(screen.getByRole('button', { name: trigger }));

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(message);
        // Severity was previously carried by icon colour alone, inaudible to AT.
        expect(within(alert).getByText(`${severity}:`)).toBeInTheDocument();
    });

    it('auto-dismisses after the frozen 4000 ms default', () => {
        renderProvider();
        fireEvent.click(screen.getByRole('button', { name: 'fire success' }));
        expect(screen.getByRole('alert')).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(3999); });
        expect(screen.queryByRole('alert')).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('stacks multiple notifications in the order they were raised', () => {
        renderProvider();
        fireEvent.click(screen.getByRole('button', { name: 'fire success' }));
        fireEvent.click(screen.getByRole('button', { name: 'fire error' }));

        const alerts = screen.getAllByRole('alert');
        expect(alerts).toHaveLength(2);
        expect(alerts[0]).toHaveTextContent('Saved successfully!');
        expect(alerts[1]).toHaveTextContent('Something broke');
    });

    it('dismisses only the chosen notification', () => {
        renderProvider();
        fireEvent.click(screen.getByRole('button', { name: 'fire success' }));
        fireEvent.click(screen.getByRole('button', { name: 'fire error' }));

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification: Saved successfully!' }));

        const alerts = screen.getAllByRole('alert');
        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toHaveTextContent('Something broke');
    });
});

describe('ToastProvider — dismiss control', () => {
    it('keeps the frozen accessible name including the message', () => {
        renderProvider();
        fireEvent.click(screen.getByRole('button', { name: 'fire error' }));
        expect(screen.getByRole('button', { name: 'Dismiss notification: Something broke' })).toBeInTheDocument();
    });

    it('is an explicit non-submitting button, so it cannot submit a surrounding form', () => {
        renderProvider();
        fireEvent.click(screen.getByRole('button', { name: 'fire error' }));
        const dismiss = screen.getByRole('button', { name: /^Dismiss notification/ });
        expect(dismiss).toHaveAttribute('type', 'button');
    });
});

describe('ToastProvider — presentation guarantees', () => {
    it('carries no legacy palette classes', () => {
        const { container } = renderProvider();
        fireEvent.click(screen.getByRole('button', { name: 'fire success' }));
        fireEvent.click(screen.getByRole('button', { name: 'fire error' }));
        fireEvent.click(screen.getByRole('button', { name: 'fire info' }));
        fireEvent.click(screen.getByRole('button', { name: 'fire warning' }));

        const markup = container.innerHTML;
        for (const legacy of [
            'green-200', 'green-50', 'green-600',
            'red-200', 'red-50', 'red-600',
            'blue-200', 'blue-50', 'blue-600',
            'yellow-200', 'yellow-50', 'yellow-600',
            'text-gray-400',
        ]) {
            expect(markup).not.toContain(legacy);
        }
    });

    it('wraps long messages and caps its width so it cannot overflow a phone', () => {
        renderProvider();
        fireEvent.click(screen.getByRole('button', { name: 'fire error' }));

        const alert = screen.getByRole('alert');
        expect(alert.className).toContain('max-w-md');
        expect(within(alert).getByText(/Something broke/).className).toContain('break-words');
    });
});

describe('ToastProvider — accessibility', () => {
    it('has no jsdom axe violations with every severity on screen', async () => {
        const { container } = renderProvider();
        fireEvent.click(screen.getByRole('button', { name: 'fire success' }));
        fireEvent.click(screen.getByRole('button', { name: 'fire error' }));
        fireEvent.click(screen.getByRole('button', { name: 'fire info' }));
        fireEvent.click(screen.getByRole('button', { name: 'fire warning' }));

        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no jsdom axe violations with a very long unbroken message', async () => {
        const { container } = render(
            <ToastProvider>
                <LongMessageHarness />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'fire long' }));
        expect((await axe(container)).violations).toEqual([]);
    });
});

function LongMessageHarness() {
    const { showError } = useToast();
    return (
        <button
            type="button"
            onClick={() => showError(`FirebaseError: ${'x'.repeat(300)}`)}
        >
            fire long
        </button>
    );
}
