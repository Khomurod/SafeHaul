import { serverMessageOf } from './callableErrors';

/**
 * What to tell a person when something failed: one plain sentence saying what
 * failed and what to do (try again, check the connection, ask the admin), never
 * a Firebase or Firestore code, a stack or a database's own English text. The
 * caller keeps the technical detail in `console.error`.
 *
 * In order:
 *  1. A callable's refusal (an `HttpsError`) carries a sentence the server wrote
 *     for the person, so it is shown as sent. Not an `internal` or `unknown`
 *     one: that text is often a raw error the server passed on. A message that
 *     is only the code means the server never answered (`serverMessageOf`).
 *  2. A plain `Error` the app raised itself with a sentence of its own is shown
 *     as written, unless it carries a database's or an SDK's words.
 *  3. A failure the person can do something about (no connection, no
 *     permission, the session ended, too many requests, the record is gone):
 *     `failed` and what to do.
 *  4. Anything else: `failed`, then "Please try again. If it keeps happening,
 *     contact support."
 *
 * @param {unknown} error what was thrown or rejected
 * @param {string} [failed] one sentence naming what failed, without advice:
 *   "The note could not be saved."
 * @returns {string}
 */
export function plainErrorMessage(error, failed = 'Something went wrong.') {
    const code = String(error?.code ?? '');
    const callable = code.startsWith('functions/');
    const canonical = callable ? code.slice('functions/'.length) : code;

    if (callable && !PASSED_ON.has(canonical)) {
        const sentence = serverMessageOf(error);
        if (sentence) return sentence;
    }
    if (isOwnSentence(error)) return error.message.trim();

    const kind = KIND_BY_CODE[canonical] ?? (isNetworkFailure(error) ? 'connection' : null);
    return `${failed} ${kind ? ADVICE[kind] : UNKNOWN_ADVICE}`;
}

/** Callable codes whose text is often another error's, passed on as it was. */
const PASSED_ON = new Set(['internal', 'unknown']);

const ADVICE = Object.freeze({
    connection: 'Check your internet connection and try again.',
    permission: 'You do not have permission to do this. If you think you should, ask your company admin.',
    session: 'Your session has ended. Sign in again, then try again.',
    busy: 'Too many requests right now. Wait a minute, then try again.',
    missing: 'It may have been removed. Refresh the page and try again.',
});

const UNKNOWN_ADVICE = 'Please try again. If it keeps happening, contact support.';

/** Firestore, Storage, Auth and callable codes (callables without `functions/`). */
const KIND_BY_CODE = Object.freeze({
    unavailable: 'connection',
    'deadline-exceeded': 'connection',
    'auth/network-request-failed': 'connection',
    'storage/retry-limit-exceeded': 'connection',
    'permission-denied': 'permission',
    'storage/unauthorized': 'permission',
    unauthenticated: 'session',
    'storage/unauthenticated': 'session',
    'auth/user-token-expired': 'session',
    'auth/requires-recent-login': 'session',
    'resource-exhausted': 'busy',
    'auth/too-many-requests': 'busy',
    'not-found': 'missing',
    'storage/object-not-found': 'missing',
});

/** Words only a database, an SDK or a runtime writes. */
const TECHNICAL = /firebase|firestore|insufficient permissions|requires an index|\b(?:auth|storage|functions)\/[a-z-]+|internal assertion|cannot read propert|is not a function|unexpected token/i;

/**
 * A plain `Error` (not a subclass: not a `FirebaseError`, a `TypeError` from a
 * bug or a failed `fetch`) with no code, whose message is a sentence rather
 * than a code word and names no database or SDK.
 */
function isOwnSentence(error) {
    if (!(error instanceof Error) || Object.getPrototypeOf(error) !== Error.prototype) return false;
    if (error.code !== undefined) return false;
    const message = String(error.message ?? '').trim();
    return /\s/.test(message) && !TECHNICAL.test(message);
}

/** `fetch` rejects with a `TypeError` when the request never got an answer. */
function isNetworkFailure(error) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    return error instanceof TypeError
        && /failed to fetch|networkerror|load failed|network request failed/i.test(String(error.message));
}
