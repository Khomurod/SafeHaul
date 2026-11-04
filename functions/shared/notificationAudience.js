/**
 * Who a record's bell notification is for, and whose action it reports
 * (`notificationTriggers.js`).
 *
 * The browser stamps who acted, in the write that makes the change: the
 * dossier and the call result stamp a status change (`statusChangedBy`,
 * `statusChangedAt`), the dossier and Assign Leads an assignment
 * (`assignmentChangedBy`, `assignmentChangedAt`). A stamp counts only when its
 * time changed in this write: a later change by a screen that stamps nothing
 * (an older release, the server) leaves the earlier stamp behind, and that
 * stamp names nobody.
 *
 * A notification with `recipientId` is shown to that person only; one with
 * `actorId` and no recipient is shown to the team but the person who acted
 * (`useCompanyNotifications.js`). Both hide a row in the bell only: the whole
 * team can read every company notification, so none may hold anything more
 * private than a name and a stage.
 */

const STATUS_STAMP = Object.freeze({ by: 'statusChangedBy', at: 'statusChangedAt' });
const ASSIGNMENT_STAMP = Object.freeze({ by: 'assignmentChangedBy', at: 'assignmentChangedAt' });

/** An instant as comparable text: a Firestore Timestamp, a Date or epoch milliseconds; else null. */
function instantKey(value) {
    if (value instanceof Date) return `ms:${value.getTime()}`;
    if (value && typeof value.seconds === 'number') return `ts:${value.seconds}:${value.nanoseconds || 0}`;
    if (value && typeof value.toMillis === 'function') return `ms:${value.toMillis()}`;
    return null;
}

/** The uid that made this change by `stamp`, or null when the write named nobody. */
function actorOf(before, after, stamp) {
    const actor = after?.[stamp.by];
    if (typeof actor !== 'string' || !actor) return null;
    const stampedAt = instantKey(after[stamp.at]);
    return stampedAt !== null && stampedAt !== instantKey(before?.[stamp.at]) ? actor : null;
}

/**
 * The record's assignee while on the company's team, else null (an unassigned
 * record, or one whose assignee left). The team cache decides
 * (`companies/{id}.teamMembers`, written by the membership trigger); a company
 * without one, or one that cannot be read, leaves the assignee as stored.
 */
async function assigneeOnTeam(db, companyId, assignedTo) {
    if (typeof assignedTo !== 'string' || !assignedTo) return null;
    try {
        const snap = await db.collection('companies').doc(companyId).get();
        const team = snap.exists ? (snap.data() || {}).teamMembers : null;
        if (!Array.isArray(team) || team.length === 0) return assignedTo;
        return team.some((member) => member?.userId === assignedTo) ? assignedTo : null;
    } catch (err) {
        console.error(`[Notifications] Could not read the team of ${companyId}; told the assignee:`, err.message);
        return assignedTo;
    }
}

/**
 * The notification's id for one delivery of a trigger's event: a repeated
 * delivery carries the same event id and adds nothing (`createNotification`).
 * Undefined, so a new id, when the event names none.
 */
function eventNotificationId(prefix, event) {
    const id = typeof event?.id === 'string' ? event.id.replace(/[^A-Za-z0-9_-]/g, '_') : '';
    return id ? `${prefix}_${id}` : undefined;
}

module.exports = { ASSIGNMENT_STAMP, STATUS_STAMP, actorOf, assigneeOnTeam, eventNotificationId };
