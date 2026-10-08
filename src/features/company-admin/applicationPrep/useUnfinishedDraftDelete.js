import { useCallback, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

/**
 * Deleting an unfinished application with everything in it, from the moment
 * Delete is pressed to the rows leaving the list.
 *
 * `purgeApplicationDraft` answers only a Company Admin (`functions/drafts/purge.js`).
 * Delete first asks it what would go: the application, its uploaded files, and
 * the same driver's other unfinished applications. The dialog opens with that
 * answer, every related application ticked, as the owner decided; the admin
 * unticks any that is somebody else's. Confirming deletes the application and
 * the ticked ones.
 *
 * A draft that is gone by the time either call lands (submitted, deleted by
 * somebody else, or expired) is reported as gone rather than as a failure: the
 * row was stale, and what the admin wanted has already happened.
 *
 * @param {{
 *   companyId: string,
 *   onDeleted: (outcome: { entry: object, deleted: string[], skipped: string[], alreadyGone: boolean }) => void,
 * }} options
 */
export function useUnfinishedDraftDelete({ companyId, onDeleted }) {
    /** The row whose deletion is being looked up, or null. */
    const [checkingKey, setCheckingKey] = useState(null);
    const [checkError, setCheckError] = useState(null);
    /** `{ entry, preview }` once the lookup answered; the dialog is open while it is set. */
    const [target, setTarget] = useState(null);
    /** The related applications the admin unticked, by key. */
    const [keep, setKeep] = useState(() => new Set());
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState(null);
    /** Only the latest press may open a dialog: a slow answer to an earlier one is dropped. */
    const latestAsk = useRef(0);

    const ask = useCallback(async (entry) => {
        const press = latestAsk.current + 1;
        latestAsk.current = press;
        setCheckError(null);
        setError(null);
        setTarget(null);
        setKeep(new Set());
        setCheckingKey(entry.applicantKey);
        try {
            const { data } = await httpsCallable(functions, 'purgeApplicationDraft')({
                companyId, applicantKey: entry.applicantKey, preview: true,
            });
            if (press !== latestAsk.current) return;
            setTarget({
                entry,
                preview: {
                    application: data?.application || null,
                    related: data?.related || [],
                    filesKeptBefore: data?.filesKeptBefore || null,
                },
            });
        } catch (previewError) {
            if (press !== latestAsk.current) return;
            if (previewError?.code === 'functions/not-found') {
                onDeleted({ entry, deleted: [entry.applicantKey], skipped: [], alreadyGone: true });
                return;
            }
            setCheckError(describeDeleteError(previewError));
        } finally {
            if (press === latestAsk.current) setCheckingKey(null);
        }
    }, [companyId, onDeleted]);

    const toggle = useCallback((applicantKey) => {
        setKeep((current) => {
            const next = new Set(current);
            if (next.has(applicantKey)) next.delete(applicantKey);
            else next.add(applicantKey);
            return next;
        });
    }, []);

    // `ConfirmDialog` cannot be dismissed while `loading`, so this never closes
    // over a delete in flight.
    const cancel = useCallback(() => {
        setTarget(null);
        setError(null);
    }, []);

    const confirm = useCallback(async () => {
        if (!target) return;
        const { entry, preview } = target;
        setDeleting(true);
        setError(null);
        try {
            const { data } = await httpsCallable(functions, 'purgeApplicationDraft')({
                companyId,
                applicantKey: entry.applicantKey,
                alsoDelete: preview.related.map((row) => row.applicantKey).filter((key) => !keep.has(key)),
            });
            setTarget(null);
            onDeleted({
                entry,
                deleted: Array.isArray(data?.deleted) ? data.deleted : [entry.applicantKey],
                skipped: Array.isArray(data?.skipped) ? data.skipped : [],
                alreadyGone: false,
            });
        } catch (deleteError) {
            if (deleteError?.code === 'functions/not-found') {
                setTarget(null);
                onDeleted({ entry, deleted: [entry.applicantKey], skipped: [], alreadyGone: true });
                return;
            }
            setError(describeDeleteError(deleteError));
        } finally {
            setDeleting(false);
        }
    }, [companyId, keep, onDeleted, target]);

    return { checkingKey, checkError, target, keep, toggle, deleting, error, ask, cancel, confirm };
}

/** A refusal in words, shown where the admin can retry. */
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
