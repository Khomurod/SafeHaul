/**
 * Whether the Documents workspace offers "Retry seal" (`retrySealDocument`):
 * for a signed document whose seal failed, or one still `pending_seal` ten
 * minutes after it was signed or last retried, when nothing is sealing it any
 * more (a seal runs 300 s at most). The server's rule, in
 * `functions/shared/sealAttempts.js`, decides; this chooses the button.
 */
export const SEAL_STUCK_AFTER_MS = 10 * 60 * 1000;

function millisOf(value) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    return null;
}

/** Whether a `pending_seal` document is past the time any seal of it could still be running. */
export function sealLeftUnfinished(document, now = Date.now()) {
    if (document?.status !== 'pending_seal') return false;
    const attempts = Array.isArray(document.sealAttempts) ? document.sealAttempts : [];
    const times = [document.signedAt, ...attempts.map((attempt) => attempt?.at)]
        .map(millisOf)
        .filter((millis) => typeof millis === 'number' && Number.isFinite(millis));
    return times.length > 0 && now - Math.max(...times) > SEAL_STUCK_AFTER_MS;
}

export function canRetrySeal(document, now = Date.now()) {
    return document?.status === 'error_sealing' || sealLeftUnfinished(document, now);
}
