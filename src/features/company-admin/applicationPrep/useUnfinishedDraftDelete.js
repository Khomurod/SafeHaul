import { useCallback, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

/**
 * Deleting one unfinished application, from the moment Delete is pressed to the
 * row leaving the list.
 *
 * `deleteApplicationDraft` answers only a Company Admin, and only for a draft
 * that is still there. A draft that is not — submitted, deleted by somebody
 * else, or expired — is reported as gone rather than as a failure: the row was
 * stale, and what the admin wanted has already happened.
 *
 * @param {{ companyId: string, onDeleted: (entry: object, outcome: { alreadyGone: boolean }) => void }} options
 */
export function useUnfinishedDraftDelete({ companyId, onDeleted }) {
    /** The row awaiting confirmation, or null when no dialog is open. */
    const [target, setTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState(null);

    const ask = useCallback((entry) => {
        setError(null);
        setTarget(entry);
    }, []);

    // `ConfirmDialog` cannot be dismissed while `loading`, so this never closes
    // over a delete in flight.
    const cancel = useCallback(() => {
        setTarget(null);
        setError(null);
    }, []);

    const confirm = useCallback(async () => {
        if (!target) return;
        setDeleting(true);
        setError(null);
        try {
            await httpsCallable(functions, 'deleteApplicationDraft')({ companyId, applicantKey: target.applicantKey });
            setTarget(null);
            onDeleted(target, { alreadyGone: false });
        } catch (deleteError) {
            if (deleteError?.code === 'functions/not-found') {
                setTarget(null);
                onDeleted(target, { alreadyGone: true });
                return;
            }
            setError(describeDeleteError(deleteError));
        } finally {
            setDeleting(false);
        }
    }, [companyId, onDeleted, target]);

    return { target, deleting, error, ask, cancel, confirm };
}

/** A refusal in words, shown inside the dialog so the admin can retry. */
export function describeDeleteError(error) {
    switch (error?.code) {
        case 'functions/permission-denied':
            return 'Only a Company Admin can delete an unfinished application.';
        case 'functions/unauthenticated':
            return 'Your session has ended. Sign in again to continue.';
        case 'functions/resource-exhausted':
            return 'Too many deletions in a row. Wait a moment and try again.';
        default:
            return 'The application could not be deleted. Try again.';
    }
}

export default useUnfinishedDraftDelete;
