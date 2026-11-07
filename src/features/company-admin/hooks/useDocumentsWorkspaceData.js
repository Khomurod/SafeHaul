import { useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { getE2EQueryParam } from '@lib/runtime/e2eMode';
import { useLiveQueryWindow } from '@shared/hooks/useLiveQueryWindow';
import { SIGNING_REQUESTS_PAGE_SIZE, useSigningRequests } from '@features/signing/hooks/useSigningRequests';
import { needsAttention, summarizeDocuments } from '../utils/documentsWorkspace';
import { needsAttentionListQuery } from '../utils/signingRequestQueries';
import { manyMockSigningRequests, mockSignedCopyRequests, mockSigningRequests } from '../views/documentsMock';
import { useSigningRequestCounts } from './useSigningRequestCounts';

const noop = () => {};

/** Every document is loaded: the numbers and the attention list come from the rows. */
function everythingLoaded(documents) {
    const attentionDocuments = documents.filter(needsAttention);
    return {
        summary: summarizeDocuments(documents),
        list: { complete: true, hasMore: false, loadMore: noop, isLoadingMore: false, loadMoreFailed: false, total: documents.length },
        attention: { documents: attentionDocuments, complete: true, isLoading: false, error: null, total: attentionDocuments.length },
    };
}

/**
 * `?e2eEdocSent=` (E2E test mode only, never a live read): `mock` serves the six
 * fixture rows, all loaded; `signedCopy` the five signed ones whose signed copy
 * is tested; `many` serves 230, 100 at a time, with the numbers and the
 * attention list over all 230, standing in for the server.
 */
function useSentFixture(mode) {
    const all = useMemo(() => {
        // `PROD` keeps the fixture rows out of a production build (`isE2ETestMode`).
        if (import.meta.env.PROD) return null;
        if (mode === 'mock') return mockSigningRequests();
        if (mode === 'signedCopy') return mockSignedCopyRequests();
        if (mode === 'many') return manyMockSigningRequests();
        return null;
    }, [mode]);
    const [shownCount, setShownCount] = useState(SIGNING_REQUESTS_PAGE_SIZE);

    return useMemo(() => {
        if (!all) return null;
        const loaded = everythingLoaded(all);
        if (mode !== 'many') return { documents: all, ...loaded };
        const documents = all.slice(0, shownCount);
        const hasMore = documents.length < all.length;
        const loadMore = () => setShownCount((count) => Math.min(all.length, count + SIGNING_REQUESTS_PAGE_SIZE));
        return {
            documents,
            summary: loaded.summary,
            attention: loaded.attention,
            list: { complete: !hasMore, hasMore, loadMore, isLoadingMore: false, loadMoreFailed: false, total: all.length },
        };
    }, [all, mode, shownCount]);
}

/**
 * The Documents workspace's signing requests, for Overview and Sent Documents.
 *
 * One live window of the newest 100 (`useSigningRequests`). While it holds
 * everything, nothing else is read and the numbers and the attention list come
 * from its rows, as they always did. Once it is full there may be more, so the
 * numbers are server counts (`useSigningRequestCounts`, read again when a
 * loaded row changes) and a second live window holds the documents that need
 * attention; both say when they are loading or failed, never a quiet zero.
 *
 * `documents` is the window's own array. `list.complete` is true once every
 * document is loaded (exactly 100 of 100 offers no Load older);
 * `attention.complete` likewise for the documents that need attention.
 */
export function useDocumentsWorkspaceData({ companyId, isE2EEdocMock }) {
    const windowed = useSigningRequests(isE2EEdocMock ? null : companyId);
    const { documents, isLoading, loadError, retry, loadMore, isLoadingMore, loadMoreFailed } = windowed;
    const windowFull = !isE2EEdocMock && Boolean(companyId) && Boolean(windowed.hasMore);

    const attentionWindow = useLiveQueryWindow({
        buildQuery: () => needsAttentionListQuery(collection(db, 'companies', companyId, 'signing_requests')),
        resetKey: companyId,
        pageSize: SIGNING_REQUESTS_PAGE_SIZE,
        enabled: windowFull,
        errorMessage: 'Documents that need attention could not be loaded.',
        logLabel: 'Error loading documents needing attention:',
    });
    const counts = useSigningRequestCounts({
        companyId,
        enabled: windowFull,
        refreshKey: `${windowed.snapshotVersion}:${attentionWindow.snapshotVersion}`,
    });
    const fixture = useSentFixture(isE2EEdocMock ? getE2EQueryParam('e2eEdocSent', '') : '');

    const local = useMemo(() => (windowFull ? null : everythingLoaded(documents)), [windowFull, documents]);
    const total = counts.summary?.total ?? null;
    const list = useMemo(() => local?.list ?? {
        complete: total !== null && documents.length >= total,
        hasMore: true,
        loadMore,
        isLoadingMore,
        loadMoreFailed,
        total,
    }, [local, total, documents, loadMore, isLoadingMore, loadMoreFailed]);

    const attentionTotal = counts.summary?.needsAttention ?? null;
    const attention = useMemo(() => local?.attention ?? {
        documents: attentionWindow.docs,
        isLoading: attentionWindow.isLoading,
        error: attentionWindow.error,
        retry: attentionWindow.retry,
        hasMore: attentionWindow.hasMore,
        loadMore: attentionWindow.loadMore,
        isLoadingMore: attentionWindow.isLoadingMore,
        loadMoreFailed: attentionWindow.loadMoreFailed,
        total: attentionTotal,
        complete: !attentionWindow.hasMore || (attentionTotal !== null && attentionWindow.docs.length >= attentionTotal),
    }, [
        local,
        attentionTotal,
        attentionWindow.docs,
        attentionWindow.isLoading,
        attentionWindow.error,
        attentionWindow.retry,
        attentionWindow.hasMore,
        attentionWindow.loadMore,
        attentionWindow.isLoadingMore,
        attentionWindow.loadMoreFailed,
    ]);

    const shared = { isLoading, loadError, retry, retryCounts: counts.refresh };
    if (fixture) return { ...shared, ...fixture, countsError: null };
    return {
        ...shared,
        documents,
        list,
        attention,
        summary: local ? local.summary : counts.summary,
        countsError: local ? null : counts.error,
    };
}

export default useDocumentsWorkspaceData;
