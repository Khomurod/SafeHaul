/**
 * PEV — the employer row's copy of a verification (`employers[i].verification`).
 *
 * `verification_requests/{token}` is authoritative and only the server reads it;
 * the row is the mirror the team sees. A server write onto the row goes through
 * here: the row is found by identity (`resolveEmployerTarget`, never a bare
 * index), and the read and the write are one transaction, so two writers on one
 * application (an answer and a reminder, say) do not erase each other.
 */
const { db } = require('../firebaseAdmin');
const { resolveEmployerTarget } = require('../shared/employerIdentity');

/** The application or lead a request belongs to. */
function recordRefOf(request) {
    return db.collection('companies').doc(request.companyId)
        .collection(request.collectionName || 'applications').doc(request.applicationId);
}

/**
 * Changes one row's verification.
 *
 * `apply(verification, row)` edits a copy (its `history` is an array) and
 * returns `false` to write nothing. It may run more than once, when the
 * transaction retries, so it only edits what it is given.
 *
 * @param {object} recordRef the application or lead
 * @param {{employerId?: string, employerIndex?: number, employerName?: string}} identity
 * @param {(verification: object, row: object) => (boolean|void)} apply
 * @returns {Promise<{index: number, employers: Array, verification: object, written: boolean}|null>}
 *   null when the record or the employer could not be found
 */
async function mirrorOntoEmployer(recordRef, identity, apply) {
    return db.runTransaction((tx) => mirrorInTransaction(tx, recordRef, identity, apply));
}

/**
 * `mirrorOntoEmployer` inside a transaction the caller runs, for a caller that
 * writes another document in the same commit. It reads the record and then
 * writes it, so the caller's own reads come first.
 */
async function mirrorInTransaction(tx, recordRef, identity, apply) {
    const snap = await tx.get(recordRef);
    if (!snap.exists) return null;
    const employers = [...(snap.data()?.employers || [])];
    const target = resolveEmployerTarget(employers, identity);
    const row = target ? employers[target.index] : null;
    if (!row) return null;

    const verification = { ...(row.verification || {}) };
    verification.history = [...(verification.history || [])];
    if (apply(verification, row) === false) {
        return { index: target.index, employers, verification: row.verification || {}, written: false };
    }
    employers[target.index] = { ...row, verification };
    tx.update(recordRef, { employers });
    return { index: target.index, employers, verification, written: true };
}

module.exports = { mirrorInTransaction, mirrorOntoEmployer, recordRefOf };
