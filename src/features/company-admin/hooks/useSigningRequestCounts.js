import { collection, getCountFromServer, query } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { useServerAggregate } from '@shared/hooks/useServerAggregate';
import {
    awaitingFailedFilter,
    awaitingFilter,
    completedFilter,
    needsAttentionFilter,
} from '../utils/signingRequestQueries';

const countOf = async (countQuery) => (await getCountFromServer(countQuery)).data().count;

/**
 * The Overview numbers as server counts, for a company with more signing
 * requests than the workspace loads. Five counts, the rules of
 * `summarizeDocuments`: total, awaiting (minus those whose send failed),
 * completed and needs attention.
 *
 * No `orderBy`: equality-only filters are served by the automatic single-field
 * indexes, so the numbers never wait for a composite index. A document with no
 * `createdAt` would be counted but not listed; every writer sets one.
 *
 * `summary` is null while the counts load or after they failed (`error`);
 * `refreshKey` reads them again (`useServerAggregate`).
 */
export function useSigningRequestCounts({ companyId, enabled, refreshKey }) {
    const { value, isLoading, error, refresh } = useServerAggregate({
        enabled: Boolean(enabled && companyId),
        refreshKey,
        run: async () => {
            const ref = collection(db, 'companies', companyId, 'signing_requests');
            const [total, awaiting, awaitingFailed, completed, needsAttention] = await Promise.all([
                countOf(query(ref)),
                countOf(query(ref, awaitingFilter())),
                countOf(query(ref, awaitingFailedFilter())),
                countOf(query(ref, completedFilter())),
                countOf(query(ref, needsAttentionFilter())),
            ]);
            return { total, awaitingSignature: awaiting - awaitingFailed, completed, needsAttention };
        },
    });

    return { summary: value, isLoading, error, refresh };
}

export default useSigningRequestCounts;
