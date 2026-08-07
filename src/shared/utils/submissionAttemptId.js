/**
 * One id per press of Submit.
 *
 * The application flow is deliberately resilient: `handleFinalSubmit` retries
 * the callable three times with backoff, and anything still undelivered goes
 * into an IndexedDB queue that replays it when connectivity returns. Both
 * mechanisms can deliver the SAME submission more than once — a call that timed
 * out after the server had already committed is indistinguishable, from the
 * browser, from one that never arrived.
 *
 * Without an id, the server has no way to tell that redelivery apart from a
 * genuine re-application, and it would write a second preserved submission
 * record: a resubmission the driver never made, and a second document claiming
 * to be an original.
 *
 * So the id is generated ONCE per press and travels with the payload through
 * every retry and every queue replay. The server keys the preserved record on
 * it. It identifies an attempt, nothing about the person, and is never shown to
 * anyone.
 */
export function newSubmissionAttemptId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `sub_${crypto.randomUUID()}`;
    }
    // Older browsers: still unique enough to distinguish redelivery of one
    // submission from a different one, which is all this needs to do.
    const random = Math.random().toString(36).slice(2, 12);
    return `sub_${Date.now().toString(36)}_${random}`;
}

export default newSubmissionAttemptId;
