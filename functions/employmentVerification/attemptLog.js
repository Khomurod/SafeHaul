/**
 * PEV — the record of every attempt to reach a previous employer.
 *
 * The request holds the authoritative log, `verification_requests/{token}.attempts`,
 * appended with `arrayUnion` (no read, so no lost update): the request going out
 * or failing to, each reminder and whether it went out, the first open, the
 * answer, an uploaded result and the day-30 mark.
 *
 * The employer row, the copy the team can read, gets a short history entry for
 * the attempts nothing else mirrors: a failed first email and each reminder.
 * The send, the open, the answer, the upload and the mark already have their
 * own row entries.
 *
 * An entry is `{ kind, at, ok, by?, error?, step?, method?, note?, recordedAt? }`.
 * Never the token, an address or an email body. `error` stays on the request,
 * which only the server reads (a mail error can name the server); the row and
 * the printed record say only that it did not go out.
 */
const { admin } = require('../firebaseAdmin');
const { logger } = require('firebase-functions');
const { mirrorOntoEmployer, recordRefOf } = require('./employerMirror');

/** The attempts a recruiter records by hand, by their names on the row and in the record. */
const MANUAL_KINDS = Object.freeze({ call: 'Phone call', fax: 'Fax', note: 'Note' });

/** A reminder's `step` (its `reminderCount`), by name. */
const REMINDER_NAMES = Object.freeze({ 1: 'First reminder', 2: 'Second reminder', 3: 'Final notice' });

const ERROR_CHARS = 200;

/**
 * One log entry. `ok` is false only for an email that did not go out; `error`
 * is kept only then. Empty fields are left out.
 */
function attemptEntry(kind, { at = admin.firestore.Timestamp.now(), ok = true, error, ...fields } = {}) {
    const entry = { kind, at, ok };
    for (const [name, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null && value !== '') entry[name] = value;
    }
    if (!ok && error !== undefined) entry.error = String(error?.message || error).slice(0, ERROR_CHARS);
    return entry;
}

/** `update` with `entry` appended to the request's log, for a write that moves the request too. */
function withAttempt(update, entry) {
    return { ...update, attempts: admin.firestore.FieldValue.arrayUnion(entry) };
}

/** Appends `entry` to the request's log. Never throws: the log must not stop the step it records. */
async function recordAttempt(requestRef, entry) {
    try {
        await requestRef.update(withAttempt({}, entry));
        return true;
    } catch (error) {
        logger.error(`[PEV] A "${entry.kind}" attempt could not be added to the request record.`, error);
        return false;
    }
}

/** An instant as ISO text: a Firestore Timestamp, a Date, epoch milliseconds or ISO text. */
function isoOf(at) {
    if (typeof at?.toMillis === 'function') return new Date(at.toMillis()).toISOString();
    const date = at instanceof Date ? at : new Date(at);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/** What the row's history calls an attempt. */
function rowAction(entry) {
    if (entry.kind === 'send_failed') return 'Request email could not be sent';
    if (entry.kind === 'reminder') {
        return `${REMINDER_NAMES[entry.step] || 'Reminder'} ${entry.ok ? 'emailed' : 'could not be sent'}`;
    }
    return MANUAL_KINDS[entry.kind] || entry.kind;
}

/** The row's short history entry for an attempt: no error text, no address. */
function rowEntryOf(entry, { recordedBy } = {}) {
    return {
        action: rowAction(entry),
        timestamp: isoOf(entry.at),
        attempt: entry.kind,
        ok: entry.ok,
        ...(entry.note ? { note: entry.note } : {}),
        ...(recordedBy ? { recordedBy } : {}),
    };
}

/**
 * Adds an attempt to the row's history (the read and the write are one
 * transaction, ./employerMirror.js). A row the server first touches gets the
 * tab's default status, so it still reads "Not Started". Never throws.
 *
 * @returns {Promise<boolean>} whether the row has it
 */
async function mirrorAttempt(request, entry) {
    try {
        const mirrored = await mirrorOntoEmployer(recordRefOf(request), request, (verification) => {
            if (!verification.status) verification.status = 'Not Started';
            verification.history.push(rowEntryOf(entry));
        });
        if (!mirrored) logger.warn(`[PEV] A "${entry.kind}" attempt matched no employer row; it is on the request record.`);
        return Boolean(mirrored);
    } catch (error) {
        logger.error(`[PEV] A "${entry.kind}" attempt could not be copied onto the employer row.`, error);
        return false;
    }
}

module.exports = {
    MANUAL_KINDS, REMINDER_NAMES, attemptEntry, isoOf, mirrorAttempt, recordAttempt, rowEntryOf, withAttempt,
};
