/**
 * What the server said when a callable failed, or null when it said nothing.
 *
 * A refusal written on the server (`HttpsError`) reaches the browser with its
 * own sentence. A failure the server never answered arrives from the web SDK
 * as a bare code instead: the browser stopped waiting ("deadline-exceeded"),
 * the function crashed ("INTERNAL", the status the runtime sends for an
 * unhandled error), the connection dropped ("internal"). A message that is only
 * the code, in whichever spelling, is therefore no answer at all.
 *
 * @param {unknown} error what the callable rejected with
 * @returns {string | null}
 */
export function serverMessageOf(error) {
    const message = String(error?.message ?? '').trim();
    const canonical = (value) => value.toLowerCase().replace(/_/g, '-');
    const code = String(error?.code ?? '').replace(/^functions\//, '');
    if (!message || canonical(message) === canonical(code)) return null;
    return message;
}
