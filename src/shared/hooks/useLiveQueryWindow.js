import { useCallback, useEffect, useRef, useState } from 'react';
import { limit, onSnapshot, query } from 'firebase/firestore';

const defaultMapDoc = (docSnap) => ({ id: docSnap.id, ...docSnap.data() });

/**
 * A live window over a query: the first `pageSize` documents, growing by
 * `pageSize` on `loadMore`. One `onSnapshot` on `query(buildQuery(),
 * limit(window))`, re-subscribed with the bigger limit, so every loaded row
 * stays live (a signature, a seal or a void shows at once).
 *
 * - `buildQuery` (a Query without a limit) and `mapDoc` are read when
 *   subscribing; a new function on each render subscribes nothing again. Only
 *   `enabled`, `resetKey`, the window size and `retry` do.
 * - Turning `enabled` on, or another `resetKey`, starts again at `pageSize`
 *   with no rows, and is `isLoading` in that same render (render-time
 *   adjustment), so a new list never paints its empty state first. Disabled:
 *   no subscription, no rows, not loading.
 * - `hasMore` is true when a snapshot fills the window, and stays true for the
 *   rest of that subscription (a delete shrinks a full window until the
 *   server refills it); a server count decides completeness. During a `loadMore`
 *   the rows stay on screen; a snapshot from the cache with fewer rows than
 *   are shown is ignored (the memory cache answers a new listen with what it
 *   still holds). A failed `loadMore` sets `loadMoreFailed`, keeps the rows and
 *   goes back to the last window that answered.
 * - `snapshotVersion` counts the snapshots after the first of each
 *   subscription: a loaded row changed. The first answer of a new or grown
 *   window is not a change.
 */
export function useLiveQueryWindow({
    buildQuery,
    resetKey,
    pageSize,
    enabled = true,
    mapDoc = defaultMapDoc,
    errorMessage,
    logLabel,
}) {
    const [shown, setShown] = useState({ enabled, resetKey });
    const [windowSize, setWindowSize] = useState(pageSize);
    const [docs, setDocs] = useState([]);
    const [isLoading, setIsLoading] = useState(enabled);
    const [error, setError] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [loadMoreFailed, setLoadMoreFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [snapshotVersion, setSnapshotVersion] = useState(0);
    const buildQueryRef = useRef(buildQuery);
    const mapDocRef = useRef(mapDoc);
    const messagesRef = useRef({ errorMessage, logLabel });
    const pendingMoreRef = useRef(false);
    const shownCountRef = useRef(0);
    const lastGoodSizeRef = useRef(pageSize);
    const subscribedKeyRef = useRef(resetKey);

    // Turned on or off, or another list: render-time adjustment, not an effect.
    if (shown.enabled !== enabled || shown.resetKey !== resetKey) {
        setShown({ enabled, resetKey });
        setWindowSize(pageSize);
        setDocs([]);
        setIsLoading(enabled);
        setError(null);
        setHasMore(false);
        setIsLoadingMore(false);
        setLoadMoreFailed(false);
    }

    useEffect(() => {
        buildQueryRef.current = buildQuery;
        mapDocRef.current = mapDoc;
        messagesRef.current = { errorMessage, logLabel };
    });

    useEffect(() => {
        if (!enabled || subscribedKeyRef.current !== resetKey) {
            // Nothing pending carries over from the list before.
            pendingMoreRef.current = false;
            shownCountRef.current = 0;
            lastGoodSizeRef.current = pageSize;
            subscribedKeyRef.current = resetKey;
        }
        if (!enabled) return undefined;

        let first = true;
        const unsubscribe = onSnapshot(
            query(buildQueryRef.current(), limit(windowSize)),
            (snapshot) => {
                const next = snapshot.docs.map(mapDocRef.current);
                const cachedAndShorter = snapshot.metadata?.fromCache === true && next.length < shownCountRef.current;
                if (pendingMoreRef.current && cachedAndShorter) return;
                pendingMoreRef.current = false;
                shownCountRef.current = next.length;
                lastGoodSizeRef.current = windowSize;
                setDocs(next);
                // Once full, the window stays "maybe more" for this subscription:
                // a delete is answered from the local cache with a row fewer
                // before the server refills the window. The caller's server
                // count says when the list is complete.
                const later = !first;
                setHasMore((full) => next.length >= windowSize || (later && full));
                setIsLoading(false);
                setIsLoadingMore(false);
                setError(null);
                if (first) first = false;
                else setSnapshotVersion((version) => version + 1);
            },
            (err) => {
                console.error(messagesRef.current.logLabel, err);
                if (pendingMoreRef.current) {
                    pendingMoreRef.current = false;
                    setLoadMoreFailed(true);
                    setIsLoadingMore(false);
                    setWindowSize(lastGoodSizeRef.current);
                    return;
                }
                setError(messagesRef.current.errorMessage);
                setIsLoading(false);
            },
        );
        return () => unsubscribe();
    }, [enabled, resetKey, windowSize, attempt, pageSize]);

    const loadMore = useCallback(() => {
        if (!enabled || !hasMore || isLoading || isLoadingMore || pendingMoreRef.current) return;
        pendingMoreRef.current = true;
        setLoadMoreFailed(false);
        setIsLoadingMore(true);
        setWindowSize((size) => size + pageSize);
    }, [enabled, hasMore, isLoading, isLoadingMore, pageSize]);

    const retry = useCallback(() => {
        if (!enabled) return;
        setError(null);
        setIsLoading(true);
        setAttempt((value) => value + 1);
    }, [enabled]);

    return { docs, isLoading, error, hasMore, loadMore, isLoadingMore, loadMoreFailed, retry, snapshotVersion };
}

export default useLiveQueryWindow;
