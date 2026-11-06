import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, getCountFromServer, getDocs, limit, orderBy, query, startAfter } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { E2E_SEED_LOGS } from '../components/campaignLogsMock';

/** Logs read at a time: the newest first, then the next ones on request. */
export const LOG_PAGE_SIZE = 200;
const MAX_LOGS = 2000; // launchLimit.js: the most a campaign holds
// The E2E "paged" fixture serves its 12 rows 5 at a time, so a browser test can press Load more.
const FIXTURE_PAGE_SIZE = 5;

/**
 * A session's logs in Firestore, one per recipient, newest first. The delivery
 * check rewrites `status`, never `timestamp`, so pages do not shift between reads.
 */
function firestoreLogs(companyId, sessionId) {
    const logsRef = collection(db, 'companies', companyId, 'bulk_sessions', sessionId, 'logs');
    const countOf = async (q) => (await getCountFromServer(q)).data().count;
    return {
        pageSize: LOG_PAGE_SIZE,
        async readPage(size, after) {
            const cursor = after ? [startAfter(after)] : [];
            const { docs } = await getDocs(query(logsRef, orderBy('timestamp', 'desc'), ...cursor, limit(size)));
            return {
                entries: docs.map((d) => ({ id: d.id, ...d.data() })),
                next: docs.length === size ? docs[docs.length - 1] : null,
            };
        },
        // The list's own order, so the count leaves out what the list leaves out (no `timestamp`).
        countAll: async () => countOf(query(logsRef, orderBy('timestamp', 'desc'))),
    };
}

/** `?e2eCampaign=mock` (E2E test mode only): the artificial rows, and no Firestore call. */
function fixtureLogs(paged) {
    return {
        pageSize: paged ? FIXTURE_PAGE_SIZE : LOG_PAGE_SIZE,
        async readPage(size, after) {
            const offset = after ?? 0;
            const entries = E2E_SEED_LOGS.slice(offset, offset + size);
            return { entries, next: entries.length === size ? offset + size : null };
        },
        countAll: async () => E2E_SEED_LOGS.length,
    };
}

function logSource(companyId, sessionId) {
    if (isE2ETestMode && getE2EQueryParam('e2eCampaign', '') === 'mock') {
        return fixtureLogs(getE2EQueryParam('e2eCampaignLogs', '') === 'paged');
    }
    return firestoreLogs(companyId, sessionId);
}

/**
 * A campaign's recipient logs, `LOG_PAGE_SIZE` at a time, with a server count
 * of all of them (`total`). A count that fails is `null`; the rows never wait for one.
 *
 * - Nothing is read while an id is missing.
 * - Another session clears the rows and is `loading` in its very first render,
 *   so no screen paints its empty state before the first read settles.
 * - `refreshKey` reads again as many rows as are shown (at least one page),
 *   keeping the rows on screen meanwhile; an older answer is dropped.
 * - `failed` says the last read of the rows failed, until one succeeds.
 * - `onError` runs once for each failed read of the rows; a change to it reads
 *   nothing again.
 */
export function useCampaignLogs({ companyId, sessionId, refreshKey = 0, onError }) {
    const sessionKey = companyId && sessionId ? `${companyId}/${sessionId}` : null;
    const [shownKey, setShownKey] = useState(sessionKey);
    const [logs, setLogs] = useState([]);
    // The last log read, where the next page starts; null when none remain.
    const [next, setNext] = useState(null);
    const [loading, setLoading] = useState(sessionKey !== null);
    const [failed, setFailed] = useState(false);
    const [total, setTotal] = useState(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [loadMoreFailed, setLoadMoreFailed] = useState(false);
    // Each first read or reload; an answer for an earlier one is dropped.
    const readsRef = useRef(0);
    const readKeyRef = useRef(null);
    const sourceRef = useRef(null);
    const moreInFlightRef = useRef(false);
    const onErrorRef = useRef(onError);
    const shownCountRef = useRef(0);

    // Another session: render-time adjustment, not an effect.
    if (shownKey !== sessionKey) {
        setShownKey(sessionKey);
        setLogs([]);
        setNext(null);
        setFailed(false);
        setTotal(null);
        setLoadingMore(false);
        setLoadMoreFailed(false);
        setLoading(sessionKey !== null);
    }

    useEffect(() => {
        onErrorRef.current = onError;
        shownCountRef.current = logs.length;
    });

    useEffect(() => {
        const read = ++readsRef.current;
        const isReload = sessionKey !== null && readKeyRef.current === sessionKey;
        readKeyRef.current = sessionKey;
        sourceRef.current = null;
        if (sessionKey === null) return;

        const source = logSource(companyId, sessionId);
        sourceRef.current = source;
        const isCurrent = () => read === readsRef.current;
        const size = isReload ? Math.min(MAX_LOGS, Math.max(source.pageSize, shownCountRef.current)) : source.pageSize;

        source.readPage(size, null).then((page) => {
            if (!isCurrent()) return;
            setLogs(page.entries);
            setNext(page.next);
            setFailed(false);
            setLoading(false);
        }, (err) => {
            if (!isCurrent()) return;
            setFailed(true);
            setLoading(false);
            onErrorRef.current?.(err);
        });

        source.countAll().then(
            (count) => { if (isCurrent()) setTotal(count); },
            (err) => {
                console.error('Failed to count campaign logs:', err);
                if (isCurrent()) setTotal(null);
            },
        );
    }, [sessionKey, companyId, sessionId, refreshKey]);

    const loadMore = useCallback(async () => {
        const source = sourceRef.current;
        if (next === null || !source || moreInFlightRef.current) return;
        moreInFlightRef.current = true;
        const read = readsRef.current;
        setLoadingMore(true);
        setLoadMoreFailed(false);
        try {
            const page = await source.readPage(source.pageSize, next);
            if (read !== readsRef.current) return;
            setLogs((shown) => {
                const shownIds = new Set(shown.map((log) => log.id));
                return [...shown, ...page.entries.filter((log) => !shownIds.has(log.id))];
            });
            setNext(page.next);
        } catch (err) {
            console.error('Failed to load more campaign logs:', err);
            if (read === readsRef.current) setLoadMoreFailed(true);
        } finally {
            moreInFlightRef.current = false;
            setLoadingMore(false);
        }
    }, [next]);

    const hasMore = next !== null && (total === null || logs.length < total);

    return { logs, loading, failed, total, hasMore, loadMore, loadingMore, loadMoreFailed };
}
