import { and, or, orderBy, query, where } from 'firebase/firestore';
import { AWAITING_STATUSES, COMPLETED_STATUSES } from './documentsWorkspace';

/**
 * The Documents workspace's server-side filters for `signing_requests`, the
 * same rules `documentsWorkspace.js` applies in the browser (its status lists
 * are imported, so each rule lives once). Builders only: nothing here reads.
 *
 * A query takes ONE composite filter. Firestore limits an OR query to 30
 * disjunctions in normal form: needs attention is 3, awaiting with a failed
 * delivery 3 statuses x 2 channels = 6. Statuses are matched exactly, and every
 * writer stores them lowercase.
 */

/** A send that failed on either channel (`deliveryFailure`). */
export const deliveryFailedFilter = () => or(
    where('emailStatus', '==', 'failed'),
    where('smsStatus', '==', 'failed'),
);

/** A failed delivery or a failed seal (`needsAttention`). */
export const needsAttentionFilter = () => or(
    where('emailStatus', '==', 'failed'),
    where('smsStatus', '==', 'failed'),
    where('status', '==', 'error_sealing'),
);

/** Still with the signer, failed delivery or not (`AWAITING_STATUSES`). */
export const awaitingFilter = () => where('status', 'in', [...AWAITING_STATUSES]);

/** Awaiting, but the send failed: `isAwaitingSignature` leaves these out. */
export const awaitingFailedFilter = () => and(awaitingFilter(), deliveryFailedFilter());

/** The signer has finished (`COMPLETED_STATUSES`). */
export const completedFilter = () => where('status', 'in', [...COMPLETED_STATUSES]);

/**
 * The documents that need attention, newest first, with no limit (the live
 * window adds it). Each OR branch with this `orderBy` needs its composite
 * index in `firestore.indexes.json` (`signingRequestIndexes.test.js`).
 */
export const needsAttentionListQuery = (ref) => query(ref, needsAttentionFilter(), orderBy('createdAt', 'desc'));
