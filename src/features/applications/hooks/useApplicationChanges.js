import { useEffect, useState, useCallback } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { skippedSummary } from '@features/applications/services/editableFields';

/**
 * Company-side hook for the change-approval workflow:
 *  - live list of pending_changes for an application (team-readable per rules)
 *  - proposeChanges(): writes edits as pending changes (server-validated allowlist),
 *    and names each field the server left out
 *  - emailReviewLink(): the server emails the review link to the application's
 *    own address; this browser learns only where, masked (`emailedTo`)
 *  - createReviewLink(): mints a token review link and copies it to the clipboard
 * The newest link is the only one that works, so each replaces the other.
 */
export function useApplicationChanges(companyId, applicationId, collectionName = 'applications') {
    const { showSuccess, showError } = useToast();
    const [pendingChanges, setPendingChanges] = useState([]);
    const [proposing, setProposing] = useState(false);
    const [linking, setLinking] = useState(false);
    const [emailing, setEmailing] = useState(false);
    const [emailedTo, setEmailedTo] = useState(null);

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
            // Each field the server left out is named, with why (`skippedSummary`).
            const leftOut = skippedSummary(res?.data?.skipped);
            const say = (message) => [message, leftOut].filter(Boolean).join(' ');
            if (applied === 0) {
                showError(say('No applicable changes were saved.'));
                return false;
            }
            showSuccess(say(`${applied} change(s) marked for driver approval.`));
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
            // The emailed link, if there was one, is the one this replaced.
            setEmailedTo(null);
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

    /**
     * Have the server email the review link to the application's own address.
     * Returns the address, masked, or null when nothing was sent; the server's
     * message, shown as it is, says why and whether the driver's link still works.
     * `appBaseUrl` says which site the driver should open; the server keeps it
     * only when it is the app's.
     */
    const emailReviewLink = useCallback(async () => {
        setEmailing(true);
        try {
            const fn = httpsCallable(functions, 'createChangeReview');
            const res = await fn({
                companyId, applicationId, collectionName, deliver: 'email', appBaseUrl: window.location.origin,
            });
            const to = res?.data?.delivered?.to;
            if (!to) throw new Error('The email could not be confirmed. Please try again.');
            setEmailedTo(to);
            showSuccess(`Review link emailed to ${to}.`);
            return to;
        } catch (e) {
            // A send that failed had made a new link nobody received, replacing the emailed one.
            if (e?.details?.reason === 'email-failed') setEmailedTo(null);
            console.error('[useApplicationChanges] emailReviewLink failed:', e?.code || e?.message || e);
            showError(e?.message || 'Could not email the review link.');
            return null;
        } finally {
            setEmailing(false);
        }
    }, [companyId, applicationId, collectionName, showSuccess, showError]);

    return {
        pendingChanges, proposing, linking, emailing, emailedTo, proposeChanges, createReviewLink, emailReviewLink,
    };
}

export default useApplicationChanges;
