import React, { useId, useRef } from 'react';
import { AlertTriangle, HelpCircle, Info } from 'lucide-react';
import { Button, StatusMedallion } from '@/design-system/components';
import { Modal } from './Modal';

/**
 * Business-neutral confirmation dialog, built on the shared accessible `Modal`.
 *
 * Added 2026-07-28 by the final-six-confirmations campaign. Before it, every
 * confirmation in the app was either a blocking `window.confirm` or one of eight
 * separately hand-written dialogs that each re-derived the same structure
 * (medallion, heading, description, Cancel/Confirm footer). This owns that
 * structure once.
 *
 * It is deliberately domain-neutral: it does not know what a campaign, template,
 * envelope or application file is. Callers supply the words, the tone and the
 * action; it owns the dialog semantics, focus behaviour, the in-flight guard and
 * the announced failure state.
 *
 * ## Why it lives in `shared/components/modals` and not `design-system/patterns`
 *
 * The design-system README places dialog structure in `patterns/`, and that is
 * where this belongs long-term. But the `Modal` it composes still lives here, and
 * the design system must not depend on `shared` — that is the inversion the
 * migration is trying to remove, not add to. So this sits beside `Modal` and moves
 * with it. Recorded in the roadmap.
 *
 * ## Behaviour contract
 *
 * - Rendering with `isOpen={false}` renders nothing, so the underlying `Modal`
 *   unmounts and restores focus to the trigger.
 * - Initial focus goes to **Cancel**, not Confirm: these dialogs guard
 *   irreversible work, and the safe action should be the one under the user's
 *   finger.
 * - Escape and backdrop dismissal are **disabled while `loading`**, so a
 *   destructive operation in flight cannot be abandoned half-way.
 * - Backdrop dismissal is off by default (`closeOnBackdrop={false}`): a stray
 *   click beside a delete dialog should not decide anything.
 * - `onConfirm` is guarded by a synchronous ref, so two activations dispatched
 *   inside one React render cannot both invoke it. Visually disabling the button
 *   is not sufficient — `loading` only takes effect on the next render.
 * - `error` renders in a live region and leaves the dialog open so the user can
 *   retry.
 *
 * @param {object} props
 * @param {boolean} [props.isOpen=true] Render the dialog. `false` renders nothing.
 * @param {string} props.title Accessible name and visible heading.
 * @param {React.ReactNode} [props.description] Accessible description.
 * @param {React.ReactNode} [props.children] Extra body content below the description.
 * @param {'danger'|'warning'|'info'} [props.tone='danger'] Severity of the action.
 * @param {string} [props.confirmLabel='Confirm'] Label for the confirming action.
 * @param {string} [props.cancelLabel='Cancel'] Label for the dismissing action.
 * @param {boolean} [props.loading=false] An invocation is in flight.
 * @param {React.ReactNode} [props.error] Announced failure; the dialog stays open.
 * @param {() => void | Promise<void>} props.onConfirm
 * @param {() => void} props.onCancel
 * @param {boolean} [props.closeOnBackdrop=false]
 */

const TONES = {
    danger: { medallion: 'danger', confirmVariant: 'danger', Icon: AlertTriangle },
    warning: { medallion: 'warning', confirmVariant: 'danger', Icon: AlertTriangle },
    info: { medallion: 'info', confirmVariant: 'primary', Icon: HelpCircle },
};

export function ConfirmDialog({
    isOpen = true,
    title,
    description,
    children,
    tone = 'danger',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    loading = false,
    error,
    onConfirm,
    onCancel,
    closeOnBackdrop = false,
}) {
    const titleId = useId();
    const descriptionId = useId();
    const cancelRef = useRef(null);
    /**
     * Ref, not the `loading` prop: `loading` is owner state and only takes effect
     * on the next render, so two activations dispatched before React re-renders
     * would both get past it.
     */
    const confirmingRef = useRef(false);

    if (!isOpen) return null;

    if (typeof title !== 'string' || title.trim() === '') {
        throw new TypeError('ConfirmDialog requires a non-empty title.');
    }
    if (!TONES[tone]) {
        throw new TypeError(`Unsupported ConfirmDialog tone: ${tone}`);
    }

    const { medallion, confirmVariant, Icon } = TONES[tone];

    const handleConfirm = async () => {
        if (confirmingRef.current || loading) return;
        confirmingRef.current = true;
        try {
            await onConfirm?.();
        } finally {
            confirmingRef.current = false;
        }
    };

    // Nothing may dismiss the dialog while the confirmed action is running.
    const handleClose = loading ? undefined : onCancel;

    return (
        <Modal
            onClose={handleClose}
            labelledBy={titleId}
            describedBy={description ? descriptionId : undefined}
            // The safe action is the one focused first.
            initialFocusRef={cancelRef}
            closeOnBackdrop={closeOnBackdrop && !loading}
            closeOnEscape={!loading}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            <div className="overflow-y-auto p-ds-5 text-center">
                <StatusMedallion tone={medallion} className="mx-auto mb-ds-3"><Icon /></StatusMedallion>
                <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content [overflow-wrap:anywhere]">
                    {title}
                </h2>
                {description && (
                    <p
                        id={descriptionId}
                        className="mt-ds-3 text-ds-sm text-ds-content-secondary [overflow-wrap:anywhere]"
                    >
                        {description}
                    </p>
                )}
                {children && <div className="mt-ds-4 text-left">{children}</div>}

                {/* Always mounted so the live region can announce a failure into it. */}
                <div role="alert" className="mt-ds-3">
                    {error && (
                        <p className="flex items-start gap-ds-2 rounded-ds-md border border-ds-status-danger-border bg-ds-status-danger-bg p-ds-3 text-left text-ds-sm text-ds-status-danger-fg [overflow-wrap:anywhere]">
                            <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                            {error}
                        </p>
                    )}
                </div>
            </div>
            <div className="flex shrink-0 flex-col-reverse justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4 sm:flex-row">
                <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={loading}>
                    {cancelLabel}
                </Button>
                <Button variant={confirmVariant} onClick={handleConfirm} disabled={loading} loading={loading}>
                    {confirmLabel}
                </Button>
            </div>
        </Modal>
    );
}

export default ConfirmDialog;
