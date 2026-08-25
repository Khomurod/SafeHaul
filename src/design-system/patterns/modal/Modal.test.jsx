import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

afterEach(cleanup);

describe('Modal (C4 accessible dialog)', () => {
    it('exposes dialog semantics with an accessible name', () => {
        render(
            <Modal label="Example dialog" onClose={() => {}}>
                <button>Inside</button>
            </Modal>,
        );
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleName('Example dialog');
    });

    it('moves focus into the dialog on open', () => {
        render(
            <Modal label="Focus dialog" onClose={() => {}}>
                <button>First action</button>
                <button>Second action</button>
            </Modal>,
        );
        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'First action' }),
        );
    });

    it('honours initialFocusRef', () => {
        function Harness() {
            const ref = React.useRef(null);
            return (
                <Modal label="Initial focus" onClose={() => {}} initialFocusRef={ref}>
                    <button>First</button>
                    <button ref={ref}>Preferred</button>
                </Modal>
            );
        }
        render(<Harness />);
        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Preferred' }),
        );
    });

    it('restores focus to the previously focused element on close', () => {
        function Harness() {
            const [open, setOpen] = React.useState(false);
            return (
                <div>
                    <button onClick={() => setOpen(true)}>Open</button>
                    {open && (
                        <Modal label="Restore dialog" onClose={() => setOpen(false)}>
                            <button>Close me</button>
                        </Modal>
                    )}
                </div>
            );
        }
        render(<Harness />);
        const opener = screen.getByRole('button', { name: 'Open' });
        opener.focus();
        fireEvent.click(opener);
        // Dialog is open and focused.
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(document.activeElement).toBe(opener);
    });

    /**
     * Regression guard for the CI failure on `main` at `113a118f`
     * (`frontend-quality`, `DriverProfileModal.behavior.test.jsx > leaves focus on
     * a real element after a successful delete`).
     *
     * When a nested confirmation and the dialog that owns it unmount in the *same*
     * commit, the inner dialog's restore target is a control inside the outer
     * dialog — which is being destroyed too. Restoring focus to it cannot succeed,
     * and depending on the order React runs the two cleanups it either does
     * nothing or drops `document.activeElement` to `<body>`. `Modal` now skips a
     * restore target that is no longer connected, so the surviving outer restore
     * is what sticks, whichever order runs.
     *
     * This asserts the contract on `Modal` itself rather than only through the
     * dossier, because every nested-dialog consumer depends on it.
     */
    it('never attempts to restore focus to an element that has left the document', () => {
        function Harness({ showTemp, open }) {
            return (
                <div>
                    <button>Trigger</button>
                    {showTemp && <button>Temp</button>}
                    {open && (
                        <Modal label="Restore guard" onClose={() => {}}>
                            <button>Inside</button>
                        </Modal>
                    )}
                </div>
            );
        }

        const { rerender } = render(<Harness showTemp open={false} />);

        // `Temp` is focused when the dialog opens, so it becomes the restore target.
        const temp = screen.getByRole('button', { name: 'Temp' });
        temp.focus();
        const tempFocus = vi.spyOn(temp, 'focus');

        rerender(<Harness showTemp open />);
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        // Now the restore target is removed while the dialog is still open — the
        // same situation a nested confirmation is in when it unmounts together
        // with the dialog that owns it.
        rerender(<Harness showTemp={false} open />);
        expect(temp.isConnected).toBe(false);

        rerender(<Harness showTemp={false} open={false} />);

        // Focusing a detached node cannot succeed. Depending on the DOM
        // implementation it is either a silent no-op or it clears
        // `document.activeElement` to `<body>` — which is what stranded the
        // keyboard user in CI. `Modal` must not make the call at all.
        expect(tempFocus).not.toHaveBeenCalled();
    });

    /**
     * Behavioural companion to the guard above, in the exact shape of the driver
     * dossier's delete flow: a nested confirmation and its owner unmount in the
     * same commit. Focus must end on the original trigger, never on `<body>`.
     */
    it('leaves focus on the original trigger when a nested dialog unmounts with its owner', () => {
        function Harness() {
            const [open, setOpen] = React.useState(false);
            const [confirming, setConfirming] = React.useState(false);
            return (
                <div>
                    <button onClick={() => setOpen(true)}>Open owner</button>
                    {open && (
                        <>
                            <Modal label="Owner dialog" onClose={() => setOpen(false)}>
                                <button onClick={() => setConfirming(true)}>Destroy</button>
                            </Modal>
                            {confirming && (
                                <Modal label="Confirm dialog" onClose={() => setConfirming(false)}>
                                    {/* Closing both at once is what the real delete flow does. */}
                                    <button onClick={() => { setConfirming(false); setOpen(false); }}>
                                        Confirm
                                    </button>
                                </Modal>
                            )}
                        </>
                    )}
                </div>
            );
        }

        render(<Harness />);
        const trigger = screen.getByRole('button', { name: 'Open owner' });
        trigger.focus();
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('button', { name: 'Destroy' }));
        expect(screen.getByRole('dialog', { name: 'Confirm dialog' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(document.activeElement).not.toBe(document.body);
        expect(document.activeElement).toBe(trigger);
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(
            <Modal label="Esc dialog" onClose={onClose}>
                <button>Inside</button>
            </Modal>,
        );
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close on Escape when closeOnEscape is false', () => {
        const onClose = vi.fn();
        render(
            <Modal label="No esc" onClose={onClose} closeOnEscape={false}>
                <button>Inside</button>
            </Modal>,
        );
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes on backdrop click but not on panel click', () => {
        const onClose = vi.fn();
        const { container } = render(
            <Modal label="Backdrop dialog" onClose={onClose}>
                <button>Inside</button>
            </Modal>,
        );
        const overlay = container.firstChild;
        fireEvent.mouseDown(screen.getByRole('dialog'));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.mouseDown(overlay);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('traps Tab from the last focusable back to the first', () => {
        render(
            <Modal label="Trap dialog" onClose={() => {}}>
                <button>First</button>
                <button>Last</button>
            </Modal>,
        );
        const first = screen.getByRole('button', { name: 'First' });
        const last = screen.getByRole('button', { name: 'Last' });
        last.focus();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
        expect(document.activeElement).toBe(first);
    });

    it('traps Shift+Tab from the first focusable to the last', () => {
        render(
            <Modal label="Trap dialog" onClose={() => {}}>
                <button>First</button>
                <button>Last</button>
            </Modal>,
        );
        const first = screen.getByRole('button', { name: 'First' });
        const last = screen.getByRole('button', { name: 'Last' });
        first.focus();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);
    });
});
