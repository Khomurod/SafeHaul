/**
 * `dqExpiresNext` — the earliest valid-until date in a driver record's DQ file.
 *
 * Every application and lead may carry it, written by the server alone: the
 * earliest `expirationDate` (`YYYY-MM-DD`) among its `dq_files` records that are
 * not removed and have one, and absent when none has. The dashboard's Needs
 * attention reads it for hired drivers (`dashboardAttention.js`, on the
 * applications status + dqExpiresNext composite).
 *
 * It is recomputed from the record's DQ files when one of them changes in a way
 * that can move it (`dqExpiresNext.js`), and when the DQ tab opens and finds the
 * stored value disagrees with the files (`syncDqFiles.js`). A record filed before
 * the field existed gets it from Data cleanup → DQ valid-until dates
 * (`maintenance/cleanup/dqExpiry.js`). It is written only when it changes, in one
 * transaction with the reads, so two DQ writes at once cannot leave the older
 * answer behind; a record that no longer exists is never written.
 */

const { admin, db } = require('../firebaseAdmin');

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** `YYYY-MM-DD` for a string that starts with a real calendar day, else null. */
function calendarDay(value) {
    if (typeof value !== 'string') return null;
    const match = DAY.exec(value.trim());
    if (!match) return null;
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return match[0];
}

/** The date one DQ record adds to the record's earliest: its own, unless it is removed or absent. */
function expiryContribution(file) {
    if (!file || file.removedAt) return null;
    return calendarDay(file.expirationDate);
}

/** The earliest date among `files` (DQ records' data), or null. */
function earliestExpiration(files) {
    const days = (files || []).map(expiryContribution).filter(Boolean).sort();
    return days[0] || null;
}

/**
 * Writes `dqExpiresNext` on the application or lead at `recordRef` from its DQ
 * files, when it differs from the stored one.
 *
 * @returns {Promise<boolean>} whether it wrote
 */
async function refreshDqExpiresNext(recordRef) {
    return db.runTransaction(async (tx) => {
        const record = await tx.get(recordRef);
        if (!record.exists) return false;
        const files = await tx.get(recordRef.collection('dq_files'));
        const next = earliestExpiration(files.docs.map((doc) => doc.data()));
        if ((record.data()?.dqExpiresNext ?? null) === next) return false;
        tx.update(recordRef, { dqExpiresNext: next ?? admin.firestore.FieldValue.delete() });
        return true;
    });
}

module.exports = { calendarDay, earliestExpiration, expiryContribution, refreshDqExpiresNext };
