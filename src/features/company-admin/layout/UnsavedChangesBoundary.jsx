import React from 'react';
import { ConfirmDialog, UnsavedChangesProvider, useUnsavedChangesGuard } from '@/design-system/patterns';

/** The one "Leave without saving?" question for every move made through the guard. */
function LeaveWithoutSavingDialog() {
    const guard = useUnsavedChangesGuard();
    return (
        <ConfirmDialog
            isOpen={guard.pending}
            tone="warning"
            title="Leave without saving?"
            description="This page has changes that have not been saved. Leaving now discards them."
            confirmLabel="Discard changes"
            cancelLabel="Keep editing"
            onConfirm={guard.confirm}
            onCancel={guard.cancel}
        />
    );
}

/**
 * Unsaved changes for the whole company area: a page reports its edits with
 * `useUnsavedChanges`, and the company menu, the top bar's switch and log out,
 * and the page's own section moves all ask here before leaving them.
 */
export function UnsavedChangesBoundary({ children }) {
    return (
        <UnsavedChangesProvider>
            {children}
            <LeaveWithoutSavingDialog />
        </UnsavedChangesProvider>
    );
}
