import React, { useCallback, useEffect, useRef } from 'react';

/**
 * Shared accessible dialog primitive (C4, WCAG 2.1 AA).
 *
 * Rendering this component means the dialog is open — parents conditionally
 * render it (`{open && <Modal .../>}`), the same convention the rest of the app
 * already uses for modals. It owns the a11y behaviour that every hand-rolled
 * overlay was missing:
 *   - `role="dialog"` + `aria-modal="true"` (with a label, by construction).
 *   - Moves focus into the dialog on open and restores it to the previously
 *     focused element on close (so keyboard users don't get dumped at the top).
 *   - Traps Tab / Shift+Tab inside the dialog while it is open.
 *   - Closes on Escape and on backdrop click (both optional via props).
 *
 * Hand-rolled rather than pulling in Radix / React-Aria: neither is a current
 * dependency, and adding one regenerates the lockfile. The surface here is small
 * and matches the existing `SignatureSheet` dialog that already ships.
 *
 * @param {object} props
 * @param {() => void} [props.onClose] Called on Escape / backdrop click. Omit for
 *   a non-dismissable dialog (e.g. a forced role choice).
 * @param {string} [props.label] Accessible name via `aria-label`. Provide this or
 *   `labelledBy`.
 * @param {string} [props.labelledBy] id of the visible heading that names the dialog.
 * @param {string} [props.describedBy] id of descriptive text for the dialog.
 * @param {boolean} [props.closeOnBackdrop=true] Whether clicking the backdrop closes.
 * @param {boolean} [props.closeOnEscape=true] Whether Escape closes.
 * @param {React.RefObject<HTMLElement>} [props.initialFocusRef] Element to focus on open.
 *   Defaults to the first focusable child, then the dialog itself.
 * @param {string} [props.overlayClassName] Classes for the backdrop element.
 * @param {string} [props.className] Classes for the dialog panel.
 * @param {React.ReactNode} props.children Dialog contents.
 */
export function Modal({
    onClose,
    label,
    labelledBy,
    describedBy,
    closeOnBackdrop = true,
    closeOnEscape = true,
    initialFocusRef,
    // Defaults migrated to `--ds-*` tokens 2026-07-28: the raw `bg-slate-900/60`
    // and `bg-white` / `rounded-2xl` / `shadow-2xl` values were design decisions
    // baked into the shared dialog, so every caller that did not override them
    // inherited an unapproved surface. `--ds-color-overlay` is the same
    // `rgb(15 23 42 / 0.6)` this used, so there is no visual change.
    overlayClassName = 'fixed inset-0 z-50 flex items-center justify-center bg-ds-overlay backdrop-blur-sm p-4',
    className = 'bg-ds-surface rounded-ds-xl shadow-ds-lg w-full max-w-lg overflow-hidden',
    children,
}) {
    const panelRef = useRef(null);
    const previouslyFocused = useRef(null);

    const getFocusable = useCallback(() => {
        const panel = panelRef.current;
        if (!panel) return [];
        const selector =
            'a[href], button:not([disabled]), textarea:not([disabled]), ' +
            'input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
            '[tabindex]:not([tabindex="-1"])';
        // Attribute-based visibility (works without layout, e.g. in tests): skip
        // anything inside a `hidden` / `aria-hidden` subtree. The selector already
        // excludes disabled controls and tabindex="-1".
        return Array.from(panel.querySelectorAll(selector)).filter(
            (el) => !el.closest('[hidden], [aria-hidden="true"]'),
        );
    }, []);

    // Focus-move-on-open + focus-restore-on-close.
    useEffect(() => {
        previouslyFocused.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;

        const target =
            initialFocusRef?.current || getFocusable()[0] || panelRef.current;
        // Defer so the dialog is in the DOM (and measurable) before focusing.
        target?.focus?.();

        return () => {
            /**
             * Only restore focus to an element that is still in the document.
             *
             * When two dialogs unmount in the same commit — a nested confirmation
             * plus the dialog that owns it, e.g. the driver dossier's "delete
             * application" flow — the inner dialog's restore target is a control
             * *inside* the outer dialog, and it is being destroyed too. Focusing a
             * detached node cannot succeed: depending on the DOM implementation it
             * is either a silent no-op or it clears `document.activeElement` to
             * `<body>`, stranding the keyboard user at the top of the page. That is
             * the CI failure on `main` at `113a118f`
             * (`DriverProfileModal.behavior.test.jsx > leaves focus on a real
             * element after a successful delete`), which passed locally and failed
             * on the runner precisely because the behaviour is environment- and
             * cleanup-order-dependent.
             *
             * With this guard the outcome is the same whichever order runs: the
             * detached restore is skipped, and the surviving outer dialog's
             * restore to the original trigger is what sticks.
             */
            const previous = previouslyFocused.current;
            if (previous?.isConnected) {
                previous.focus?.();
            }
        };
        // Mount/unmount only — re-running would steal focus on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleKeyDown = (e) => {
        if (e.key === 'Escape' && closeOnEscape && onClose) {
            e.stopPropagation();
            onClose();
            return;
        }
        if (e.key !== 'Tab') return;

        const focusable = getFocusable();
        if (focusable.length === 0) {
            // Nothing focusable: keep focus on the panel rather than escaping.
            e.preventDefault();
            panelRef.current?.focus?.();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
            if (active === first || active === panelRef.current) {
                e.preventDefault();
                last.focus();
            }
        } else if (active === last) {
            e.preventDefault();
            first.focus();
        }
    };

    const handleOverlayMouseDown = (e) => {
        // Only a click that starts and ends on the backdrop itself dismisses;
        // a drag that began inside the panel must not.
        if (e.target === e.currentTarget && closeOnBackdrop && onClose) {
            onClose();
        }
    };

    return (
        <div className={overlayClassName} onMouseDown={handleOverlayMouseDown}>
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={label}
                aria-labelledby={labelledBy}
                aria-describedby={describedBy}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
                className={className}
            >
                {children}
            </div>
        </div>
    );
}

export default Modal;
