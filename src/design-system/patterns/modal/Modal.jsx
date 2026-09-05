import React, { useCallback, useEffect, useRef } from 'react';
import './Modal.css';

/**
 * The six chrome axes, enumerated.
 *
 * A misspelled value must throw rather than render something plausible. The
 * campaign's own history is the argument: `size="3xl"` silently falling back to
 * the default is exactly how 30 spellings of one intention accumulated without
 * anyone noticing, because nothing ever said no.
 */
const CHROME = {
    size: ['sm', 'md', 'lg', 'xl', '2xl', '4xl', '5xl', '7xl'],
    scroll: ['panel', 'body'],
    mobile: ['inset', 'fullscreen'],
    placement: ['center', 'bottom'],
    tone: ['neutral', 'danger'],
};

function assertChrome(values) {
    for (const [prop, allowed] of Object.entries(CHROME)) {
        if (allowed.includes(values[prop])) continue;
        throw new TypeError(
            `Modal: unsupported ${prop} "${values[prop]}". Expected one of `
            + `${allowed.map((value) => `'${value}'`).join(', ')}. The dialog chrome is a `
            + 'contract, not a class list — if none of these is the shape you need, add the '
            + 'case here with the roadmap row that justifies it.',
        );
    }
}



/**
 * The accessible dialog primitive (C4, WCAG 2.2 AA).
 *
 * Every overlay in the product goes through this one component. A repository
 * scan for `fixed inset-0` should return only `Modal.css` and callers still
 * passing an `overlayClassName`; anything else is a hand-built dialog missing
 * the behaviour below.
 *
 * The dialog's CHROME — size, scroll model, fill, mobile treatment, placement
 * and tone — is a contract of six enumerated props; see `Modal.css` and
 * `README.md`. What is here is the behaviour.
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
 * @param {'sm'|'md'|'lg'|'xl'|'2xl'|'4xl'|'5xl'|'7xl'} [props.size='lg'] Panel width.
 * @param {'panel'|'body'} [props.scroll='panel'] `panel` scrolls the whole panel;
 *   `body` makes the panel a column so a header and footer inside it stay pinned.
 * @param {boolean} [props.fill=false] Fix the panel height instead of capping it,
 *   for a viewer that must not resize as its content changes.
 * @param {'inset'|'fullscreen'} [props.mobile='inset'] Below 640px, `fullscreen`
 *   takes the whole screen — for the dialogs that are really a screen.
 * @param {'center'|'bottom'} [props.placement='center'] `bottom` is a sheet.
 * @param {'neutral'|'danger'} [props.tone='neutral'] Borders a destructive dialog.
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
    size = 'lg',
    scroll = 'panel',
    fill = false,
    mobile = 'inset',
    placement = 'center',
    tone = 'neutral',
    /*
     * Still named, so passing one is a loud refusal rather than a silent
     * `...rest` that lands on the DOM as an unknown attribute. They were the
     * escape hatch that let 38 call sites spell the same six intentions 30
     * different ways; every one of them is migrated, and the hatch is shut.
     */
    overlayClassName,
    className,
    children,
}) {
    assertChrome({ size, scroll, mobile, placement, tone });
    if (overlayClassName !== undefined || className !== undefined) {
        throw new TypeError(
            'Modal: `className` and `overlayClassName` were removed on 2026-09-05. They '
            + 'REPLACED the dialog chrome rather than extending it, which is how 38 call '
            + 'sites came to write 30 spellings of the same six intentions. Use `size`, '
            + '`scroll`, `fill`, `mobile`, `placement` and `tone`; if none of those is the '
            + 'shape you need, add the case to `Modal.css` with the roadmap row that '
            + 'justifies it — do not reintroduce a class list.',
        );
    }
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
        <div
            className="ds-modal"
            data-placement={placement}
            data-mobile={mobile}
            onMouseDown={handleOverlayMouseDown}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={label}
                aria-labelledby={labelledBy}
                aria-describedby={describedBy}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
                className="ds-modal__panel"
                data-size={size}
                data-scroll={scroll}
                data-fill={fill || undefined}
                data-tone={tone}
            >
                {children}
            </div>
        </div>
    );
}

export default Modal;
