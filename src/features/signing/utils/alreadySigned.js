/**
 * Whether the document behind a signing link is already signed.
 *
 * Two ways to know:
 *
 *  1. **The server says so.** `getPublicEnvelope` answers a submitted request with
 *     its status: `signed` alone, or the envelope with `pending_seal` /
 *     `error_sealing` while the seal is made. The set is the server's
 *     `COMPLETED_REQUEST_STATUSES` (`functions/shared/postApplicationRequest.js`).
 *     `processing` is not in it: a submission that hung there may be sent again.
 *  2. **This device signed it.** A submission deletes the link's token, so the
 *     same link opened again is refused like a wrong one (`permission-denied`)
 *     and the server cannot say why. The room records here, after the server
 *     accepted the submission, that this device signed it and when — ids and a
 *     time, nothing the signer typed — so the signer who taps the email again
 *     on the same phone is told it is signed rather than that the link failed.
 */
const SIGNED_STATUSES = new Set(['pending_seal', 'signed', 'sealed', 'completed', 'error_sealing']);

export const isSignedStatus = (status) => SIGNED_STATUSES.has(status);

const KEY_PREFIX = 'signing_signed_v1';
const signedKey = (companyId, requestId) => `${KEY_PREFIX}:${companyId}:${requestId}`;

/** After the server accepted the submission. Best effort: storage may be off. */
export function rememberSignedHere(companyId, requestId, at = new Date()) {
    try {
        localStorage.setItem(signedKey(companyId, requestId), at.toISOString());
    } catch {
        /* storage disabled or full: the link then reads as one that no longer works */
    }
}

/** @returns {string|null} when this device signed the document, as an ISO time */
export function signedHereAt(companyId, requestId) {
    try {
        const value = localStorage.getItem(signedKey(companyId, requestId));
        return value && Number.isFinite(Date.parse(value)) ? value : null;
    } catch {
        return null;
    }
}
