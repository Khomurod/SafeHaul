import { useCallback, useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@lib/firebase';

/**
 * Live company signing requests.
 *
 * Extracted verbatim from `EnvelopeHistory` so the Documents workspace can read
 * the same data for its Overview metrics and its Sent Documents table without
 * opening a second subscription. The query, the ordering (`createdAt` desc),
 * the mapped document shape and the error handling are unchanged — this is a
 * move, not a behaviour change.
 *
 * `retry` re-establishes the subscription after a failure without remounting
 * the view.
 */
export function useSigningRequests(companyId) {
    const [documents, setDocuments] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [attempt, setAttempt] = useState(0);

    const retry = useCallback(() => {
        setLoadError(null);
        setIsLoading(true);
        setAttempt((value) => value + 1);
    }, []);

    useEffect(() => {
        // No company (or the caller is supplying data itself): there is nothing
        // to wait for, so never leave the view stuck in a loading state.
        if (!companyId) {
            setDocuments([]);
            setLoadError(null);
            setIsLoading(false);
            return undefined;
        }
        setIsLoading(true);
        // MED-1: onSnapshot for real-time status updates.
        const q = query(
            collection(db, 'companies', companyId, 'signing_requests'),
            orderBy('createdAt', 'desc'),
        );
        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                setDocuments(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
                setLoadError(null);
                setIsLoading(false);
            },
            (error) => {
                console.error('Error loading history:', error);
                // Surface the failure visibly instead of showing an empty history.
                setLoadError('Could not load document history. Please try again.');
                setIsLoading(false);
            },
        );
        return () => unsubscribe();
    }, [companyId, attempt]);

    return { documents, isLoading, loadError, retry };
}

export default useSigningRequests;
