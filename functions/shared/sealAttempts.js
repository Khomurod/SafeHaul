/**
 * When a signing request is sealed: what `sealDocument` and `retrySealDocument`
 * (`sealRetry.js`) agree on.
 *
 * A request is sealed when it enters `pending_seal` (the signer submitted, or a
 * failed seal was retried), or when a retry records a new attempt while it is
 * still there (a seal left unfinished: the run that should have sealed it died).
 * Each retry appends one entry to `sealAttempts`, so the number of entries names
 * the attempt, and a delivery is current only while the stored request is still
 * on the attempt it was delivered for.
 *
 * A seal runs for 300 s at most (`digitalSealing.js`), so a request still
 * `pending_seal` ten minutes after it was signed or last retried is not being
 * sealed, and only then may it be sealed again.
 */

const SEAL_STUCK_AFTER_MS = 10 * 60 * 1000;

/** How many times the request was sealed again: the entries of `sealAttempts`. */
function sealAttemptCount(request) {
    return Array.isArray(request?.sealAttempts) ? request.sealAttempts.length : 0;
}

/** Whether an update from `before` to `after` asks for a seal. */
function asksForSeal(before, after) {
    if (after?.status !== 'pending_seal') return false;
    return before?.status !== 'pending_seal' || sealAttemptCount(after) > sealAttemptCount(before);
}

function millisOf(value) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return null;
}

/** When the latest attempt to seal began: the signing or the newest retry; null when unknown. */
function sealPendingSince(request) {
    const attempts = Array.isArray(request?.sealAttempts) ? request.sealAttempts : [];
    const times = [request?.signedAt, ...attempts.map((attempt) => attempt?.at)]
        .map(millisOf)
        .filter((millis) => typeof millis === 'number' && Number.isFinite(millis));
    return times.length > 0 ? Math.max(...times) : null;
}

/** Whether a `pending_seal` request is past the time any seal of it could still be running. */
function sealLeftUnfinished(request, now = Date.now()) {
    if (request?.status !== 'pending_seal') return false;
    const since = sealPendingSince(request);
    return since !== null && now - since > SEAL_STUCK_AFTER_MS;
}

module.exports = { SEAL_STUCK_AFTER_MS, asksForSeal, sealAttemptCount, sealLeftUnfinished, sealPendingSince };
