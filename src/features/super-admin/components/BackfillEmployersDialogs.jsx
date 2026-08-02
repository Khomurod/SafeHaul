import React, { useId } from 'react';
import { AlertTriangle, Wrench } from 'lucide-react';
import { Button } from '@/design-system/components';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Confirmation and result dialogs for the employer-field backfill maintenance
 * action.
 *
 * These replace a blocking `window.confirm()` guard and a blocking `alert()`
 * report. Both were real defects: `window.confirm`/`alert` freeze the page, are
 * not stylable, are suppressible by the browser ("prevent this page from
 * creating additional dialogs" silently makes a destructive action unguarded),
 * and give assistive technology none of the dialog semantics the shared `Modal`
 * provides. The maintenance action itself is unchanged — the confirmation still
 * gates it, and the same four counters are still reported.
 */
export function BackfillEmployersConfirmDialog({ onConfirm, onCancel }) {
    const titleId = useId();
    const descriptionId = useId();

    return (
        <Modal onClose={onCancel} labelledBy={titleId} describedBy={descriptionId}>
            <div className="p-ds-5">
                <h2
                    id={titleId}
                    className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content"
                >
                    <AlertTriangle className="text-ds-status-warning-fg" aria-hidden="true" />
                    Run employer field backfill?
                </h2>
                <p id={descriptionId} className="mt-ds-3 text-ds-sm text-ds-content-secondary">
                    This will rename old employer field names in existing applications across every
                    company. It runs against live data and may take a few minutes.
                </p>
            </div>
            <div className="flex justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                <Button variant="primary" onClick={onConfirm}>
                    <Wrench size={16} aria-hidden="true" />
                    Run backfill
                </Button>
            </div>
        </Modal>
    );
}

/**
 * @param {{ stats: {totalDocs?: number, updatedDocs?: number, skippedDocs?: number,
 *   errorDocs?: number}, onClose: () => void }} props
 */
export function BackfillEmployersResultDialog({ stats, onClose }) {
    const titleId = useId();
    const rows = [
        ['Total applications', stats.totalDocs || 0],
        ['Updated', stats.updatedDocs || 0],
        ['Already correct', stats.skippedDocs || 0],
        ['Errors', stats.errorDocs || 0],
    ];

    return (
        <Modal onClose={onClose} labelledBy={titleId}>
            <div className="p-ds-5">
                <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">
                    Employer backfill report
                </h2>
                <dl className="mt-ds-4 space-y-ds-2">
                    {rows.map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-ds-4 text-ds-sm">
                            <dt className="text-ds-content-secondary">{label}</dt>
                            <dd className="font-semibold text-ds-content">{value}</dd>
                        </div>
                    ))}
                </dl>
            </div>
            <div className="flex justify-end border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="primary" onClick={onClose}>Close</Button>
            </div>
        </Modal>
    );
}
