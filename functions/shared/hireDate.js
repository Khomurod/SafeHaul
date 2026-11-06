'use strict';

/**
 * An application's hire date, `hiredAt`: the time of the write by which its status
 * last entered a hired status (`HIRED_STATUSES`), on any path — the dossier, Super
 * Admin, a direct database edit — recorded by the application write trigger
 * (`onApplicationWrittenDashboardRollup`) from its event's time, so a hire made just
 * before midnight stays in its own month. An event without a readable time gets the
 * server's time instead.
 *
 * - Only a write INTO hired sets it: a record created hired, or one moved from a
 *   status that is not. A save while already hired leaves it as it is.
 * - Leaving hired keeps it. Coming back sets it again, so a re-hire carries its own
 *   date and a status undone and set again carries the later one.
 * - Recorded from the day this shipped: never backfilled, never inferred from
 *   `createdAt`, `updatedAt`, `statusChangedAt` or the activity log.
 *
 * Its own write enters nothing (the status does not change), so the trigger does
 * not loop and the dashboard counters do not move again.
 */
const { admin, db } = require('../firebaseAdmin');
const { isHiredStatus } = require('./applicationStatus');

/** True when this write moves an application into a hired status. */
function entersHiredStatus(before, after) {
    if (!after || !isHiredStatus(after.status)) return false;
    return !before || !isHiredStatus(before.status);
}

const millisOf = (value) => (typeof value?.toMillis === 'function' ? value.toMillis() : NaN);

/**
 * Stamps `hiredAt` for a write, made at `changedAtMillis`, that hired the driver.
 * Read again in a transaction: a record deleted since is left alone, and one whose
 * `hiredAt` is already at or after that write (this event delivered twice) is not
 * moved. Returns whether it wrote.
 */
async function recordHireDate(ref, changedAtMillis) {
    return db.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists) return false;
        if (millisOf((snap.data() || {}).hiredAt) >= changedAtMillis) return false;
        const hiredAt = Number.isFinite(changedAtMillis)
            ? admin.firestore.Timestamp.fromMillis(changedAtMillis)
            : admin.firestore.FieldValue.serverTimestamp();
        transaction.update(ref, { hiredAt });
        return true;
    });
}

module.exports = { entersHiredStatus, recordHireDate };
