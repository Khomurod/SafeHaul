import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@lib/firebase';

const IDLE = Object.freeze({ key: null, status: 'idle', session: null, error: null });

/**
 * One campaign session, live, by id: the report a launched draft links to,
 * when that session is not among the ones the list has loaded (an older one).
 * `status` is `idle` without an id, then `loading`, `found`, `missing` (no such
 * session) or `failed` (it could not be read). Nothing is read without an id.
 */
export function useCampaignSessionById(companyId, sessionId) {
    const key = companyId && sessionId ? `${companyId}/${sessionId}` : null;
    const [state, setState] = useState(IDLE);

    useEffect(() => {
        if (!key) return undefined;
        setState({ key, status: 'loading', session: null, error: null });
        return onSnapshot(
            doc(db, 'companies', companyId, 'bulk_sessions', sessionId),
            (snap) => setState(snap.exists()
                ? { key, status: 'found', session: { id: snap.id, ...snap.data() }, error: null }
                : { key, status: 'missing', session: null, error: null }),
            (error) => setState({ key, status: 'failed', session: null, error }),
        );
    }, [key, companyId, sessionId]);

    // An answer for another id is not this one's: until its own arrives, it is loading.
    if (!key) return IDLE;
    return state.key === key ? state : { key, status: 'loading', session: null, error: null };
}
