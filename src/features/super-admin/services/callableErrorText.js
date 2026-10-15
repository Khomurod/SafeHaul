/**
 * User-facing text for a failed owner-panel callable, shared by the consoles'
 * service clients. Each client passes its own sentences for the codes where its
 * screen says something else.
 *
 * Backend messages are value-free but not all written for an operator, so the
 * common codes get stable sentences, and only `invalid-argument` and
 * `failed-precondition` pass the server's own explanation through (which
 * setting is missing, why a release is not allowed), without the `Error:`-style
 * prefix in front of it.
 */

/** The server's message without its leading `…: ` prefix, else the fallback. */
export const serverReason = (error, fallback) => error.message?.replace(/^.*?:\s*/, '') || fallback;

/** The server's message exactly as sent, else the fallback. */
export const serverMessage = (error, fallback) => error.message || fallback;

const COMMON_TEXT = Object.freeze({
    unauthenticated: 'Your session has ended. Sign in again to continue.',
    'permission-denied': 'Super Admin access is required for this action.',
    'resource-exhausted': 'Too many requests. Wait a moment and try again.',
    'invalid-argument': serverReason,
    'failed-precondition': serverReason,
});

/**
 * @param {unknown} error a callable failure (`code` is `functions/<code>`)
 * @param {string} fallback the sentence for anything not mapped
 * @param {Record<string, string | ((error: object, fallback: string) => string)>} [texts]
 *   per-console sentences by code (without `functions/`), replacing the common
 *   ones; `default` answers every code nothing else maps
 */
export function callableErrorText(error, fallback, texts = {}) {
    if (!error) return fallback;
    const code = typeof error.code === 'string' && error.code.startsWith('functions/')
        ? error.code.slice('functions/'.length)
        : null;
    const text = (code && Object.hasOwn(texts, code) ? texts[code] : null)
        ?? (code && Object.hasOwn(COMMON_TEXT, code) ? COMMON_TEXT[code] : null)
        ?? texts.default
        ?? fallback;
    return typeof text === 'function' ? text(error, fallback) : text;
}
