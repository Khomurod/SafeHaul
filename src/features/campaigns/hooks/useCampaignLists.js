import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getAggregateFromServer, getCountFromServer, onSnapshot, orderBy, query, sum, where } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { useLiveQueryWindow } from '@shared/hooks/useLiveQueryWindow';
import { useServerAggregate } from '@shared/hooks/useServerAggregate';
import { CANCELLABLE_SESSION_STATUSES, isLaunchedDraft } from '../constants/campaignConstants';
import { e2eCampaignLists } from '../components/campaignListsMock';

/** Drafts and campaigns listed at a time: the newest first, more on request. */
export const CAMPAIGN_LIST_PAGE_SIZE = 50;

// "Live Campaigns" counts these; a paused session is live (listed, cancellable) but not counted.
const COUNTED_AS_LIVE = ['active', 'queued', 'scheduled'];
const SESSIONS_ERROR = 'Campaigns could not be loaded.';
const noop = () => {};

const sessionsRef = (companyId) => collection(db, 'companies', companyId, 'bulk_sessions');
const draftsRef = (companyId) => collection(db, 'companies', companyId, 'campaign_drafts');
const draftsQuery = (companyId) => query(draftsRef(companyId), orderBy('updatedAt', 'desc'));
// An unlaunched draft has no `launchedAt`, which no query can select: the
// launched ones are counted and left out instead.
const launchedDraftsQuery = (companyId) => query(draftsRef(companyId), where('launchedAt', '!=', null));
const historyQuery = (companyId) => query(sessionsRef(companyId), orderBy('createdAt', 'desc'));
const countOf = async (countQuery) => (await getCountFromServer(countQuery)).data().count;

/** A bulk session as the campaign cards and details read it. */
function toSessionCard(d) {
    const data = d.data();
    return {
        id: d.id,
        name: data.name,
        status: data.status,
        createdAt: data.createdAt,
        updatedAt: data.lastUpdateAt || data.createdAt, // Map for CampaignCard
        messageConfig: data.config, // Map for CampaignCard
        matchCount: data.progress?.totalCount || data.targetIds?.length || 0,
        progress: data.progress, // Pass full progress for bar
        ...data
    };
}

/** A stored time (a Timestamp, its `{ seconds }` form, or anything with `toDate`) in ms; null if none. */
function millisOf(time) {
    if (!time) return null;
    if (typeof time.toMillis === 'function') return time.toMillis();
    if (typeof time.seconds === 'number') return time.seconds * 1000;
    if (typeof time.toDate === 'function') return time.toDate().getTime();
    return null;
}

function newestFirst(a, b) {
    const left = millisOf(a.createdAt);
    const right = millisOf(b.createdAt);
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
}

/**
 * The history window in its server order, then the live sessions it leaves out
 * (older than the window), newest first, missing dates last. A session in both
 * appears once, as the window's copy.
 */
function mergeSessions(historyDocs, liveDocs) {
    const listed = new Set(historyDocs.map((session) => session.id));
    const older = liveDocs.filter((session) => !listed.has(session.id));
    return older.length === 0 ? historyDocs : [...historyDocs, ...older.sort(newestFirst)];
}

/**
 * Every live (active, queued, scheduled, paused) session, live. No `limit`:
 * nothing caps how many a company runs at once, and a cap could drop one and
 * its Cancel control. No `orderBy`, so the automatic status index serves it.
 * `version` counts the snapshots after the first: a live session changed.
 */
function useLiveSessions(companyId, enabled) {
    const key = enabled ? companyId : null;
    const [shownKey, setShownKey] = useState(key);
    const [docs, setDocs] = useState([]);
    const [isLoading, setIsLoading] = useState(enabled);
    const [error, setError] = useState(null);
    const [version, setVersion] = useState(0);
    const [attempt, setAttempt] = useState(0);

    // Another company, or turned on or off: render-time adjustment, not an effect.
    if (shownKey !== key) {
        setShownKey(key);
        setDocs([]);
        setIsLoading(enabled);
        setError(null);
    }

    useEffect(() => {
        if (!enabled) return undefined;
        let first = true;
        const unsubscribe = onSnapshot(
            query(sessionsRef(companyId), where('status', 'in', CANCELLABLE_SESSION_STATUSES)),
            (snapshot) => {
                setDocs(snapshot.docs.map(toSessionCard));
                setIsLoading(false);
                setError(null);
                if (first) first = false;
                else setVersion((value) => value + 1);
            },
            (err) => {
                console.error('Error loading live campaigns:', err);
                setError(SESSIONS_ERROR);
                setIsLoading(false);
            },
        );
        return () => unsubscribe();
    }, [companyId, enabled, attempt]);

    const retry = useCallback(() => {
        if (!enabled) return;
        setError(null);
        setIsLoading(true);
        setAttempt((value) => value + 1);
    }, [enabled]);

    return { docs, isLoading, error, version, retry };
}

/** One list as the dashboard reads it. Exactly N of N loaded offers no Load more. */
function listOf(liveWindow, items, total, overrides = {}) {
    const complete = !liveWindow.hasMore || (total !== null && items.length >= total);
    return {
        items,
        isLoading: liveWindow.isLoading,
        error: liveWindow.error,
        hasMore: !complete,
        loadMore: liveWindow.loadMore,
        isLoadingMore: liveWindow.isLoadingMore,
        loadMoreFailed: liveWindow.loadMoreFailed,
        total: complete ? null : total,
        retry: liveWindow.retry,
        ...overrides,
    };
}

const liveCountOf = (sessions) => sessions.filter((session) => COUNTED_AS_LIVE.includes(session.status)).length;
const outreachOf = (sessions) => sessions.reduce((acc, s) => acc + (s.progress?.processedCount || 0), 0);

/**
 * `?e2eCampaign=mock` (E2E test mode only, never a read): the seeded draft and
 * session, all loaded. `&e2eCampaignList=many`: 60 of each, 50 at a time, with
 * the numbers and totals over all 60, standing in for the server.
 */
function useFixtureLists(mode) {
    const all = useMemo(() => (mode ? e2eCampaignLists(mode) : null), [mode]);
    const [shown, setShown] = useState({ drafts: CAMPAIGN_LIST_PAGE_SIZE, sessions: CAMPAIGN_LIST_PAGE_SIZE });
    if (!all) return null;

    const list = (name) => {
        const items = mode === 'many' ? all[name].slice(0, shown[name]) : all[name];
        const hasMore = items.length < all[name].length;
        const loadMore = () => setShown((current) => ({ ...current, [name]: current[name] + CAMPAIGN_LIST_PAGE_SIZE }));
        return {
            items,
            isLoading: false,
            error: null,
            hasMore,
            loadMore,
            isLoadingMore: false,
            loadMoreFailed: false,
            total: hasMore ? all[name].length : null,
            retry: noop,
        };
    };
    return {
        drafts: list('drafts'),
        sessions: list('sessions'),
        liveCount: liveCountOf(all.sessions),
        totalOutreach: outreachOf(all.sessions),
    };
}

/**
 * The Campaigns dashboard's lists and numbers.
 *
 * - Drafts and the session history are live windows of the newest 50
 *   (`useLiveQueryWindow`), growing by 50 on `loadMore`. Drafts leaves out the
 *   launched ones (`isLaunchedDraft`), in its rows and its count. A third listener holds
 *   every live session, so one older than the window is still listed (after
 *   the window's rows) with its Cancel control.
 * - `liveCount` counts the merged sessions, which hold every live one: exact.
 *   It is null when the live listener failed and the history is incomplete.
 * - `totalOutreach` is today's sum over the sessions while the history is
 *   complete; once it is not, a server sum, re-read at most every 2 s while a
 *   loaded or live session changes (`useServerAggregate`). Null while that sum
 *   loads or after it failed, or when the history failed: never a partial sum.
 * - `total` is a server count, read only while a list's window is full; null
 *   once the list is complete.
 * - `sessions.isLoading`, `error` and `retry` cover the history and the live
 *   listener together.
 */
export function useCampaignLists({ companyId, enabled }) {
    const isE2EMock = isE2ETestMode && getE2EQueryParam('e2eCampaign', '') === 'mock';
    const isE2EMany = isE2EMock && getE2EQueryParam('e2eCampaignList', '') === 'many';
    const reads = Boolean(enabled && companyId) && !isE2EMock;

    const drafts = useLiveQueryWindow({
        buildQuery: () => draftsQuery(companyId),
        resetKey: companyId,
        pageSize: CAMPAIGN_LIST_PAGE_SIZE,
        enabled: reads,
        errorMessage: 'Campaign drafts could not be loaded.',
        logLabel: 'Error loading campaign drafts:',
    });
    const history = useLiveQueryWindow({
        buildQuery: () => historyQuery(companyId),
        resetKey: companyId,
        pageSize: CAMPAIGN_LIST_PAGE_SIZE,
        enabled: reads,
        mapDoc: toSessionCard,
        errorMessage: SESSIONS_ERROR,
        logLabel: 'Error loading campaigns:',
    });
    const live = useLiveSessions(companyId, reads);

    const draftsTotal = useServerAggregate({
        enabled: drafts.hasMore,
        refreshKey: drafts.snapshotVersion,
        run: async () => {
            const [all, launched] = await Promise.all([countOf(draftsQuery(companyId)), countOf(launchedDraftsQuery(companyId))]);
            return all - launched;
        },
    });
    const sessionsTotal = useServerAggregate({
        enabled: history.hasMore,
        refreshKey: history.snapshotVersion,
        run: () => countOf(historyQuery(companyId)),
    });
    const outreach = useServerAggregate({
        enabled: history.hasMore,
        refreshKey: `${companyId}:${history.snapshotVersion}:${live.version}`,
        run: async () => {
            const snapshot = await getAggregateFromServer(query(sessionsRef(companyId)), { outreach: sum('progress.processedCount') });
            return snapshot.data().outreach;
        },
    });
    const fixture = useFixtureLists(isE2EMock ? (isE2EMany ? 'many' : 'mock') : null);
    const draftItems = useMemo(() => drafts.docs.filter((draft) => !isLaunchedDraft(draft)), [drafts.docs]);
    const sessions = useMemo(() => mergeSessions(history.docs, live.docs), [history.docs, live.docs]);
    const retryHistory = history.retry;
    const retryLive = live.retry;
    const retrySessions = useCallback(() => {
        retryHistory();
        retryLive();
    }, [retryHistory, retryLive]);

    if (fixture) return fixture;

    let totalOutreach = outreachOf(sessions);
    if (history.hasMore) totalOutreach = outreach.value;
    else if (history.error) totalOutreach = null;

    return {
        drafts: listOf(drafts, draftItems, draftsTotal.value),
        sessions: listOf(history, sessions, sessionsTotal.value, {
            isLoading: history.isLoading || live.isLoading,
            error: history.error || live.error,
            retry: retrySessions,
        }),
        liveCount: live.error && history.hasMore ? null : liveCountOf(sessions),
        totalOutreach,
    };
}

export default useCampaignLists;
