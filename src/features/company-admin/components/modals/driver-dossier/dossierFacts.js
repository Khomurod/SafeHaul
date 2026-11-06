import { formatDate } from '@shared/utils/helpers';

/**
 * The dossier's key facts as text (`DossierKeyFacts`): the day a record came
 * in and its last call. Display only; nothing here is written.
 */

function millisOf(value) {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    const millis = new Date(value).getTime();
    return Number.isNaN(millis) ? null : millis;
}

/** A stored date as the dossier shows it, or '' when there is none to show. */
function shownDate(value, withTime = false) {
    const text = value ? formatDate(value, withTime) : '';
    return text === '--' ? '' : text;
}

/**
 * The day the list's Applied / Added column shows (`addedDateOf` in
 * `candidateListColumns.jsx`: `createdAt`, else `submittedAt`), under the same
 * name: Applied for an application, Added for a lead. Null when there is none.
 */
export function recordDayOf(appData, collectionName) {
    const day = shownDate(appData?.createdAt || appData?.submittedAt);
    if (!day) return null;
    return { label: collectionName === 'leads' ? 'Added' : 'Applied', day };
}

/**
 * The last call as the call log writes it (`useCallOutcome`: `lastCallOutcome`,
 * `lastContactedAt`), or null when none was logged. A campaign message moves
 * `lastContactedAt` too, writing `lastBulkMessageAt` with it
 * (`functions/bulkActions/workers/sendLoop.js`): then that time is the
 * message's, not the call's, and the result is shown without one.
 */
export function lastCallOf(appData) {
    const outcome = typeof appData?.lastCallOutcome === 'string' ? appData.lastCallOutcome.trim() : '';
    if (!outcome) return null;
    const contacted = millisOf(appData.lastContactedAt);
    const messaged = millisOf(appData.lastBulkMessageAt);
    const isCallTime = contacted !== null && (messaged === null || messaged < contacted);
    return { outcome, at: isCallTime ? shownDate(appData.lastContactedAt, true) : '' };
}
