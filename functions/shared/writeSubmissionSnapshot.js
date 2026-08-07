// functions/shared/writeSubmissionSnapshot.js
//
// Persists a submission snapshot to
// `companies/{companyId}/applications/{applicationId}/submission/{sequence}`.
//
// WHY A SEQUENCE RATHER THAN A FIXED DOC
// --------------------------------------
// `upsertApplicationDoc` deliberately supports re-submission: the same applicant
// key re-applying merges into the existing application document. If the snapshot
// lived at a fixed id, a re-submission would overwrite the record of the first
// one — destroying exactly the evidence this whole design exists to protect.
//
// So each submission claims the next free sequence number, and sequence 1 is the
// ORIGINAL submission. Later downloads of "the original" resolve to it forever,
// and a re-submission adds a sibling instead of mutating history.
//
// CONCURRENCY
// -----------
// The claim uses `create()`, which fails if the document already exists. Two
// concurrent submissions therefore cannot both take the same sequence: the loser
// gets ALREADY_EXISTS and moves to the next number. That is atomic without a
// transaction, and it cannot silently overwrite.
//
// IDEMPOTENCY
// -----------
// A sequence per submission is right for a genuine RE-submission and wrong for a
// REDELIVERY. The applicant's browser retries `submitGuestApplication` three
// times with backoff, and the offline queue replays the identical payload later.
// A call that timed out after the server had already committed would come back
// as a second submission and take sequence 2 — inventing a resubmission the
// driver never made, and putting a second "original" in the record.
//
// So each submission attempt carries a client-generated `submissionAttemptId`
// that is stable across every retry and replay of that one press of Submit.
// Before claiming a sequence, this module looks for a snapshot already carrying
// that id and returns it instead. Firestore queries are strongly consistent, and
// the browser's retries are sequential with backoff, so a redelivery reliably
// sees the earlier write.
//
// An attempt with no id is treated as its own submission, which is the old
// behaviour — a client too old to send one is not made worse.

/** Hard ceiling on sequence probing, so a pathological loop cannot spin. */
const MAX_SNAPSHOT_SEQUENCE = 50;

/** Firestore ALREADY_EXISTS, by gRPC code or message. */
function isAlreadyExists(error) {
    if (!error) return false;
    if (error.code === 6 || error.code === 'already-exists') return true;
    return /ALREADY_EXISTS/i.test(String(error.message || ''));
}

/**
 * Write a snapshot under the next free sequence number.
 *
 * @param {object} opts
 * @param {object} opts.db             Firestore (Admin SDK).
 * @param {string} opts.companyId
 * @param {string} opts.applicationId
 * @param {object} opts.snapshot       Output of buildSubmissionSnapshot.
 * @param {object} [opts.ownerIds]     `{ applicantId, driverId }` — stamped so the
 *   Firestore owner-read rule can identify the driver, exactly as dq_files does.
 *   These are access-control metadata and are never presented to users.
 * @param {string} [opts.submissionAttemptId] Stable across every retry and
 *   offline replay of ONE press of Submit. Makes the write idempotent.
 * @param {string} [opts.logLabel]
 * @returns {Promise<{snapshotId: string, sequence: number, isOriginal: boolean, deduplicated: boolean}>}
 */
async function writeSubmissionSnapshot({
    db,
    companyId,
    applicationId,
    snapshot,
    ownerIds = {},
    submissionAttemptId = null,
    logLabel = 'writeSubmissionSnapshot',
}) {
    if (!db) throw new Error('writeSubmissionSnapshot requires a Firestore instance');
    if (!companyId || !applicationId) {
        throw new Error('writeSubmissionSnapshot requires companyId and applicationId');
    }
    if (!snapshot || typeof snapshot !== 'object') {
        throw new Error('writeSubmissionSnapshot requires a snapshot');
    }

    const collection = db
        .collection('companies').doc(companyId)
        .collection('applications').doc(applicationId)
        .collection('submission');

    const attemptId = typeof submissionAttemptId === 'string' && submissionAttemptId.trim()
        ? submissionAttemptId.trim()
        : null;

    // A redelivery of an attempt already recorded returns that record rather
    // than manufacturing a resubmission the driver never made.
    if (attemptId) {
        const existing = await collection
            .where('submissionAttemptId', '==', attemptId)
            .limit(1)
            .get();
        if (!existing.empty) {
            const doc = existing.docs[0];
            const sequence = doc.data().sequence;
            console.log(
                `[${logLabel}] Submission attempt ${attemptId} was already recorded as `
                + `${doc.id} for application ${applicationId} (company ${companyId}); not writing again`
            );
            return {
                snapshotId: doc.id,
                sequence,
                isOriginal: sequence === 1,
                deduplicated: true,
            };
        }
    }

    const payload = {
        ...snapshot,
        // Tenant binding, mirroring the application document itself.
        companyId,
        applicationId,
        // Owner ids for canReadApplicationSubcollectionDoc. Not presentation data.
        applicantId: ownerIds.applicantId || applicationId,
        driverId: ownerIds.driverId || applicationId,
        submissionAttemptId: attemptId,
    };

    let lastError = null;
    for (let sequence = 1; sequence <= MAX_SNAPSHOT_SEQUENCE; sequence += 1) {
        const snapshotId = `v${sequence}`;
        try {
            await collection.doc(snapshotId).create({ ...payload, sequence });
            console.log(
                `[${logLabel}] Wrote submission snapshot ${snapshotId} for application ${applicationId} (company ${companyId})`
            );
            return { snapshotId, sequence, isOriginal: sequence === 1, deduplicated: false };
        } catch (error) {
            if (!isAlreadyExists(error)) throw error;
            lastError = error;
            // Taken — either by an earlier submission or a concurrent one. Try next.
        }
    }

    throw new Error(
        `Could not claim a submission snapshot sequence for ${applicationId} after ${MAX_SNAPSHOT_SEQUENCE} attempts: ${lastError && lastError.message}`
    );
}

/**
 * Resolve the ORIGINAL submission snapshot for an application.
 *
 * Always sequence 1. Returns null when the application predates snapshots, which
 * callers must surface as "no preserved record" rather than silently rendering
 * live data as though it were the submitted original.
 */
async function readOriginalSubmissionSnapshot({ db, companyId, applicationId }) {
    const ref = db
        .collection('companies').doc(companyId)
        .collection('applications').doc(applicationId)
        .collection('submission').doc('v1');
    const snap = await ref.get();
    return snap.exists ? snap.data() : null;
}

module.exports = {
    MAX_SNAPSHOT_SEQUENCE,
    isAlreadyExists,
    readOriginalSubmissionSnapshot,
    writeSubmissionSnapshot,
};
