import { and, or, orderBy, query, where } from 'firebase/firestore';
import { AWAITING_STATUSES, COMPLETED_STATUSES, OPEN_STATUSES } from './documentsWorkspace';

/**
 * The Documents workspace's server-side filters for `signing_requests`, the
 * same rules `documentsWorkspace.js` applies in the browser (its status lists
 * are imported, so each rule lives once). Builders only: nothing here reads.
 *
 * A query takes ONE composite filter. Firestore limits an OR query to 30
 * disjunctions in normal form: an open document with a failed delivery is 2
 * statuses x 2 channels = 4, needs attention that and a failed seal = 5.
 * Statuses are matched exactly, and every writer stores them lowercase.
 *
 * "Link expired" (`isLinkExpired`) has no server filter on purpose: `status`
 * with an `expiresAt` range needs a composite index. The counts take an expired
 * link as awaiting a signature, as `summarizeDocuments` does, and the Link
 * expired filter looks at the loaded documents only, like every other filter.
 */

/** A send that failed on either channel (`deliveryFailure`). */
export const deliveryFailedFilter = () => or(
    where('emailStatus', '==', 'failed'),
    where('smsStatus', '==', 'failed'),
);

/** Awaiting a signature, failed delivery or not (`AWAITING_STATUSES`). */
export const awaitingFilter = () => where('status', 'in', [...AWAITING_STATUSES]);

/**
 * Open, but the send failed (`hasDeliveryFailure`): `isAwaitingSignature`
 * leaves these out. The open statuses are among the awaiting ones, so the
 * counts subtract this exactly.
 */
export const awaitingFailedFilter = () => and(where('status', 'in', [...OPEN_STATUSES]), deliveryFailedFilter());

/** A failed delivery while the document is open, or a failed seal (`needsAttention`). */
export const needsAttentionFilter = () => or(awaitingFailedFilter(), where('status', '==', 'error_sealing'));

/** The signer has finished (`COMPLETED_STATUSES`). */
export const completedFilter = () => where('status', 'in', [...COMPLETED_STATUSES]);

/**
 * The documents that need attention, newest first, with no limit (the live
 * window adds it). Each branch of its normal form with this `orderBy` needs its
 * composite index in `firestore.indexes.json` (`signingRequestIndexes.test.js`).
 */
export const needsAttentionListQuery = (ref) => query(ref, needsAttentionFilter(), orderBy('createdAt', 'desc'));
