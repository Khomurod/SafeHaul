import React, { useId } from 'react';
import { Button } from '@/design-system/components';
import { ConfirmDialog, Modal } from '@design-system/patterns';

/**
 * Confirmation and result dialogs for the employer-field backfill maintenance
 * action.
 *
 * These replace a blocking `window.confirm()` guard and a blocking `alert()`
 * report. Both were real defects: `window.confirm`/`alert` freeze the page, are
 * not stylable, are suppressible by the browser ("prevent this page from
 * creating additional dialogs" silently makes a destructive action unguarded),
 * and give assistive technology none of the dialog semantics the approved `Modal`
 * provides. The maintenance action itself is unchanged — the confirmation still
 * gates it, and the same four counters are still reported.
 */
/*
 * The approved `ConfirmDialog` since 2026-08-25. Hand-composed before that, and
 * the odd one out even among the ten hand-composed confirmations: it had no
 * medallion, putting the warning icon *inside* the heading instead, so the same
 * kind of question looked different here than anywhere else. It also lost what
 * the pattern adds — initial focus on Cancel rather than on a live-data rename,
 * and a synchronous guard against a double activation.
 *
 * The confirm label drops its `Wrench` icon: no other confirm in the product has
 * one, and the pattern's `confirmLabel` is words. Backdrop dismissal is off, which
 * this dialog did not set — a stray click beside a live-data rename should not
 * decide anything.
 */
export function BackfillEmployersConfirmDialog({ onConfirm, onCancel }) {
    return (
        <ConfirmDialog
            tone="warning"
            title="Run employer field backfill?"
            description="This will rename old employer field names in existing applications across every company. It runs against live data and may take a few minutes."
            confirmLabel="Run backfill"
            onCancel={onCancel}
            onConfirm={onConfirm}
        />
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
