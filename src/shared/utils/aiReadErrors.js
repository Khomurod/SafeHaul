import { serverMessageOf } from './callableErrors';

/**
 * What to tell a person when an AI read fails.
 *
 * The AI callables answer a failure with a sentence written for the person
 * reading it, naming what to do next, so that sentence is shown. A failure the
 * server never answered arrives as a bare code (`serverMessageOf`), which means
 * nothing to a driver or a recruiter, so the caller's own sentence replaces it.
 *
 * @param {unknown} error what the callable rejected with
 * @param {string} fallback the caller's sentence for an unexplained failure
 * @returns {string}
 */
export function aiReadErrorMessage(error, fallback) {
    return serverMessageOf(error) ?? fallback;
}
