import React from 'react';
import { ConfirmDialog } from '@design-system/patterns';

/**
 * The question before a phone line is removed. Replaces the blocking
 * `window.confirm` that once guarded removal; the warning wording is preserved
 * verbatim.
 *
 * The approved `ConfirmDialog`, so this destructive question looks like every
 * other one; the pattern puts initial focus on Cancel rather than on "Remove
 * line" and guards `onConfirm` against a double activation.
 */
export function RemoveLineDialog({ line, onCancel, onConfirm }) {
    return (
        <ConfirmDialog
            tone="danger"
            title="Remove phone line?"
            description={(
                <>
                    Are you sure you want to remove <strong className="font-mono text-ds-content">{line.phoneNumber}</strong>? Any users assigned to this line will be unassigned.
                </>
            )}
            confirmLabel="Remove line"
            onCancel={onCancel}
            onConfirm={onConfirm}
        />
    );
}
