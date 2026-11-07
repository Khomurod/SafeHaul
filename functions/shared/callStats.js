/**
 * How a logged call counts in `companies/{id}/stats_daily/{date}`, which Super
 * Admin → Analytics reads. One definition for the live trigger
 * (`statsAggregator.js`, one call at a time) and the rebuild
 * (`statsBackfill.js`, every call again), so the two cannot disagree.
 *
 *  - A call is a log with `action: 'Call Logged'`, or an older one with
 *    `type: 'call'` and no `action`; notes and status changes never count.
 *  - "Connected" is derived from the outcome here, never from the client's own
 *    `isContact`.
 *  - The day is the call's America/Chicago calendar day.
 */

const CONTACT_OUTCOMES = new Set(['interested', 'callback', 'not_qualified', 'not_interested', 'hired_elsewhere']);

/** The counter an outcome adds to; an outcome not named counts as a dial only. */
const OUTCOME_COUNTERS = new Map([
    ['interested', 'interested'],
    ['callback', 'callback'],
    ['not_interested', 'notInterested'],
    // An availability signal, not "not interested".
    ['hired_elsewhere', 'hiredElsewhere'],
    ['not_qualified', 'notQualified'],
    // A data-quality signal, not "not qualified".
    ['wrong_number', 'wrongNumber'],
    ['voicemail', 'voicemail'],
    ['no_answer', 'voicemail'],
]);

const CHICAGO_DAY = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function isCallLog(data) {
    return data.action === 'Call Logged' || (data.type === 'call' && !data.action);
}

/** A day with no calls yet. */
function emptyDayStats() {
    return {
        totalDials: 0,
        connected: 0,
        interested: 0,
        voicemail: 0,
        callback: 0,
        notInterested: 0,
        hiredElsewhere: 0,
        notQualified: 0,
        wrongNumber: 0,
        byUser: {},
    };
}

function emptyUserStats(name) {
    return {
        name,
        dials: 0,
        connected: 0,
        interested: 0,
        voicemail: 0,
        callback: 0,
        notInterested: 0,
        hiredElsewhere: 0,
        notQualified: 0,
        wrongNumber: 0,
    };
}

/**
 * Adds one log to a day's stats, in place, by its caller (`performedBy`, else
 * `unknown`) too. Returns whether the log was a call; anything else is left out.
 */
function addCallToDayStats(stats, data) {
    if (!isCallLog(data)) return false;
    const userId = data.performedBy || 'unknown';
    const outcome = data.outcome || 'other';
    const isContact = CONTACT_OUTCOMES.has(outcome);
    const counter = OUTCOME_COUNTERS.get(outcome);

    stats.totalDials = (stats.totalDials || 0) + 1;
    if (isContact) stats.connected = (stats.connected || 0) + 1;
    if (counter) stats[counter] = (stats[counter] || 0) + 1;

    if (!stats.byUser[userId]) stats.byUser[userId] = emptyUserStats(data.performedByName || 'Unknown');
    const user = stats.byUser[userId];
    user.dials = (user.dials || 0) + 1;
    if (isContact) user.connected = (user.connected || 0) + 1;
    if (counter) user[counter] = (user[counter] || 0) + 1;
    return true;
}

/**
 * The America/Chicago day (YYYY-MM-DD) of a log's `timestamp` (a Firestore
 * Timestamp or a Date). With none, or one that cannot be read, today's.
 */
function chicagoDayKey(timestamp, label = 'CallStats') {
    try {
        let at;
        if (timestamp && typeof timestamp.toDate === 'function') at = timestamp.toDate();
        else if (timestamp instanceof Date) at = timestamp;
        else at = new Date();
        return CHICAGO_DAY.format(at);
    } catch (err) {
        console.warn(`[${label}] Could not parse timestamp:`, err);
        return CHICAGO_DAY.format(new Date());
    }
}

module.exports = { CONTACT_OUTCOMES, isCallLog, emptyDayStats, addCallToDayStats, chicagoDayKey };
