/**
 * The driver's page, once the company has deleted the unfinished application.
 *
 * A Company Admin can delete an unfinished application with everything in it
 * (`functions/drafts/purge.js`). The server then tells the holder of one of its
 * tokens so, and only them (`functions/drafts/removalMarks.js`):
 *
 * - a save answers `{ saved: false, removed: true }`;
 * - a restore and a link answer `not-found` with `details.reason: 'removed'`.
 *
 * `useDiscardAwareResume` takes it from there as it takes a discard, for a token
 * the tab still holds: a `removed:` mark tells every tab, the queued submissions
 * recorded against the old mark are dropped (`useSubmissionQueue`) and so is the
 * queued screen that promised them, and the copy, the token and the answers on
 * screen go, typed here or restored, since this tab's saves made the application
 * the company deleted.
 */

export const REMOVED_MESSAGE = 'The company removed this unfinished application. You can start a new one.';

/** A restore or a link the server refused because the company deleted the application. */
export function isRemovedRefusal(error) {
    return error?.code === 'functions/not-found' && error?.details?.reason === 'removed';
}
