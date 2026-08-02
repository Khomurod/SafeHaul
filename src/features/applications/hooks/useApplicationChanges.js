import { useEffect, useState, useCallback } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback/ToastProvider';

/**
 * Company-side hook for the change-approval workflow:
 *  - live list of pending_changes for an application (team-readable per rules)
 *  - proposeChanges(): writes edits as pending changes (server-validated allowlist)
 *  - createReviewLink(): mints a token review link and copies it to the clipboard
 */
export function useApplicationChanges(companyId, applicationId, collectionName = 'applications') {
    const { showSuccess, showError } = useToast();
    const [pendingChanges, setPendingChanges] = useState([]);
    const [proposing, setProposing] = useState(false);
    const [linking, setLinking] = useState(false);

    useEffect(() => {
        if (!companyId || !applicationId) return undefined;
        const col = collection(db, 'companies', companyId, collectionName, applicationId, 'pending_changes');
        const unsub = onSnapshot(
            col,
            (snap) => setPendingChanges(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
            (err) => console.warn('[useApplicationChanges] pending_changes listener:', err?.message || err),
        );
        return () => unsub();
    }, [companyId, applicationId, collectionName]);

    /** changes: [{ fieldKey, proposedValue }] */
    const proposeChanges = useCallback(async (changes) => {
        if (!Array.isArray(changes) || changes.length === 0) {
            showError('No changes to propose.');
            return false;
        }
        setProposing(true);
        try {
            const fn = httpsCallable(functions, 'proposeApplicationChanges');
            const res = await fn({ companyId, applicationId, collectionName, changes });
            const applied = res?.data?.applied?.length || 0;
            if (applied === 0) {
                showError('No applicable changes were saved.');
                return false;
            }
            showSuccess(`${applied} change(s) marked for driver approval.`);
            return true;
        } catch (e) {
            console.error('[useApplicationChanges] propose failed:', e);
            showError(e?.message || 'Could not save changes.');
            return false;
        } finally {
            setProposing(false);
        }
    }, [companyId, applicationId, collectionName, showSuccess, showError]);

    /** Mint a review link and copy it to the clipboard. Returns the URL (or null). */
    const createReviewLink = useCallback(async () => {
        setLinking(true);
        try {
            const fn = httpsCallable(functions, 'createChangeReview');
            const res = await fn({ companyId, applicationId, collectionName });
            const path = res?.data?.path;
            if (!path) throw new Error('No link returned.');
            const url = `${window.location.origin}${path}`;
            try {
                await navigator.clipboard.writeText(url);
                showSuccess('Review link copied to clipboard.');
            } catch {
                showSuccess('Review link created.');
            }
            return url;
        } catch (e) {
            console.error('[useApplicationChanges] createReviewLink failed:', e);
            showError(e?.message || 'Could not create the review link.');
            return null;
        } finally {
            setLinking(false);
        }
    }, [companyId, applicationId, collectionName, showSuccess, showError]);

    return { pendingChanges, proposing, linking, proposeChanges, createReviewLink };
}

export default useApplicationChanges;
