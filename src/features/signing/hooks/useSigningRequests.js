import { collection, orderBy, query } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { useLiveQueryWindow } from '@shared/hooks/useLiveQueryWindow';

/** Signing requests kept live at a time: the newest first, more on request. */
export const SIGNING_REQUESTS_PAGE_SIZE = 100;

/**
 * Live company signing requests: a window of the newest `pageSize` by
 * `createdAt` desc, growing by `pageSize` on `loadMore`.
 *
 * The Documents workspace reads it once for its Overview and its Sent Documents
 * table (`useDocumentsWorkspaceData`); `EnvelopeHistory` reads it only when no
 * `documents` prop is given. Reading the whole history on every visit grew
 * slower and dearer each month, so only the newest rows are loaded, and every
 * loaded row stays live (a signature, a seal or a void shows at once).
 * `hasMore` says the window is full, so older documents may exist.
 *
 * `retry` re-establishes the subscription after a failure without remounting
 * the view.
 */
export function useSigningRequests(companyId, { pageSize = SIGNING_REQUESTS_PAGE_SIZE } = {}) {
    const live = useLiveQueryWindow({
        buildQuery: () => query(collection(db, 'companies', companyId, 'signing_requests'), orderBy('createdAt', 'desc')),
        resetKey: companyId,
        pageSize,
        enabled: Boolean(companyId),
        errorMessage: 'Could not load document history. Please try again.',
        logLabel: 'Error loading history:',
    });

    return {
        documents: live.docs,
        isLoading: live.isLoading,
        loadError: live.error,
        retry: live.retry,
        hasMore: live.hasMore,
        loadMore: live.loadMore,
        isLoadingMore: live.isLoadingMore,
        loadMoreFailed: live.loadMoreFailed,
        snapshotVersion: live.snapshotVersion,
    };
}

export default useSigningRequests;
