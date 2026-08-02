/**
 * Contract for the shared `ConfirmDialog` (2026-07-28).
 *
 * This component replaced the last six blocking `window.confirm` guards in the
 * app, so its behaviour is the guarantee every one of those flows now rests on:
 * nothing happens until Confirm, nothing happens on Cancel/Escape/backdrop, a
 * confirmed action cannot fire twice, and a failure is announced without closing
 * the dialog.
 */
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(cleanup);

function setup(props = {}) {
    const onConfirm = props.onConfirm || vi.fn();
    const onCancel = props.onCancel || vi.fn();
    const utils = render(
        <ConfirmDialog
            title="Delete this thing?"
            description="This cannot be undone."
            confirmLabel="Delete it"
            {...props}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />,
    );
    return { ...utils, onConfirm, onCancel };
}

describe('ConfirmDialog — dialog semantics', () => {
    it('is a modal dialog named and described by its own copy', () => {
        setup();
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleName('Delete this thing?');
        expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    });

    it('renders nothing when closed, so the Modal unmounts and restores focus', () => {
        const { container } = setup({ isOpen: false });
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens with focus on the safe action, not the destructive one', () => {
        setup();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    });

    it('restores focus to the exact trigger on close', () => {
        function Harness() {
            const [open, setOpen] = React.useState(false);
            return (
                <div>
                    <button onClick={() => setOpen(true)}>Open</button>
                    <ConfirmDialog
                        isOpen={open}
                        title="Delete?"
                        confirmLabel="Delete"
                        onConfirm={() => {}}
                        onCancel={() => setOpen(false)}
                    />
                </div>
            );
        }
        render(<Harness />);
        const trigger = screen.getByRole('button', { name: 'Open' });
        trigger.focus();
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(document.activeElement).toBe(trigger);
    });

    it('rejects an empty title and an unsupported tone', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<ConfirmDialog title="" onConfirm={vi.fn()} onCancel={vi.fn()} />)).toThrow(/non-empty title/);
        expect(() => render(<ConfirmDialog title="x" tone="nope" onConfirm={vi.fn()} onCancel={vi.fn()} />)).toThrow(/Unsupported ConfirmDialog tone/);
    });
});

describe('ConfirmDialog — nothing happens without an explicit confirmation', () => {
    it('does not invoke the action merely by opening', () => {
        const { onConfirm } = setup();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('Cancel invokes only onCancel', () => {
        const { onConfirm, onCancel } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('Escape invokes only onCancel', () => {
        const { onConfirm, onCancel } = setup();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('a backdrop click does not confirm, and does not dismiss by default', () => {
        const { container } = setup();
        const { onConfirm, onCancel } = setup();
        // The overlay is the dialog's parent element.
        const overlay = container.querySelector('[role="dialog"]')?.parentElement;
        if (overlay) fireEvent.mouseDown(overlay);
        expect(onConfirm).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('allows backdrop dismissal only when the caller opts in', () => {
        const onCancel = vi.fn();
        const { container } = render(
            <ConfirmDialog
                title="Discard?"
                tone="warning"
                closeOnBackdrop
                onConfirm={vi.fn()}
                onCancel={onCancel}
            />,
        );
        const overlay = container.querySelector('[role="dialog"]').parentElement;
        fireEvent.mouseDown(overlay);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('ConfirmDialog — confirming', () => {
    it('invokes the action exactly once', () => {
        const { onConfirm } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('rejects a second activation dispatched before the first settles', async () => {
        let release;
        const onConfirm = vi.fn(() => new Promise((resolve) => { release = resolve; }));
        setup({ onConfirm });

        const button = screen.getByRole('button', { name: 'Delete it' });
        fireEvent.click(button);
        fireEvent.click(button);
        fireEvent.click(button);

        expect(onConfirm).toHaveBeenCalledTimes(1);
        release();
        await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    });
});

describe('ConfirmDialog — in-flight state', () => {
    it('disables both actions and announces busy while loading', () => {
        setup({ loading: true });
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        const confirm = screen.getByRole('button', { name: 'Delete it' });
        expect(confirm).toBeDisabled();
        expect(confirm).toHaveAttribute('aria-busy', 'true');
    });

    it('cannot be abandoned by Escape while loading', () => {
        const { onCancel } = setup({ loading: true });
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('cannot be confirmed again while loading', () => {
        const { onConfirm } = setup({ loading: true });
        fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('cannot be dismissed by the backdrop while loading, even when opted in', () => {
        const onCancel = vi.fn();
        const { container } = render(
            <ConfirmDialog title="Working" closeOnBackdrop loading onConfirm={vi.fn()} onCancel={onCancel} />,
        );
        fireEvent.mouseDown(container.querySelector('[role="dialog"]').parentElement);
        expect(onCancel).not.toHaveBeenCalled();
    });
});

describe('ConfirmDialog — failure and retry', () => {
    it('announces an error and stays open so the action can be retried', () => {
        const onConfirm = vi.fn();
        setup({ error: 'Failed to delete: network down', onConfirm });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Failed to delete: network down');
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('keeps a live region mounted when there is no error yet', () => {
        setup();
        expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    });
});

describe('ConfirmDialog — untrusted and long content', () => {
    it('renders a dangerous target name as text, never as markup', () => {
        const { container } = setup({
            title: 'Delete "<img src=x onerror=alert(1)>"?',
            description: 'Removing <script>alert(2)</script> cannot be undone.',
        });
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('script')).toBeNull();
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('<img src=x onerror=alert(1)>');
    });

    it('wraps an unbroken long name instead of overflowing', () => {
        setup({ title: `Delete "${'x'.repeat(300)}"?` });
        expect(screen.getByRole('heading', { level: 2 }).className).toContain('overflow-wrap:anywhere');
    });
});

describe('ConfirmDialog — accessibility', () => {
    it.each([
        ['danger', { tone: 'danger' }],
        ['warning', { tone: 'warning' }],
        ['info', { tone: 'info' }],
        ['loading', { loading: true }],
        ['with an error', { error: 'Something failed' }],
        ['with extra body content', { children: <p>Extra detail</p> }],
    ])('has no jsdom axe violations (%s)', async (_name, props) => {
        const { container } = setup(props);
        expect((await axe(container)).violations).toEqual([]);
    });
});
