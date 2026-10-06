/**
 * What to tell a person when an AI read fails.
 *
 * The AI callables answer a failure with a sentence written for the person
 * reading it, naming what to do next, so that sentence is shown. A failure the
 * server never answered arrives from the web SDK as a bare code instead: the
 * browser stopped waiting ("deadline-exceeded"), the function crashed
 * ("INTERNAL", the status the runtime sends for an unhandled error), the
 * connection dropped. A code means nothing to a driver or a recruiter, so the
 * caller's own sentence replaces it, in whichever spelling it came.
 *
 * @param {unknown} error what the callable rejected with
 * @param {string} fallback the caller's sentence for an unexplained failure
 * @returns {string}
 */
export function aiReadErrorMessage(error, fallback) {
    const message = String(error?.message ?? '').trim();
    const canonical = (value) => value.toLowerCase().replace(/_/g, '-');
    const code = String(error?.code ?? '').replace(/^functions\//, '');
    if (!message || canonical(message) === canonical(code)) return fallback;
    return message;
}
