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
// that is stable across every retry and replay of that one press of Submit, and
// the attempt is claimed inside a TRANSACTION that both reads the claim marker
// and writes the snapshot.
//
// A read followed by an independent create would not be enough. Two deliveries
// of one attempt — a browser retry racing the offline queue's replay, or two
// tabs — can both observe "no snapshot yet" before either has written. One then
// takes v1 and the other takes v2, and the retry is permanently recorded as a
// resubmission the driver never made: a second "original" in the evidence. The
// transaction serialises on the claim marker, so the second delivery sees the
// first one's claim and returns it instead of inventing a submission.
//
// An attempt with no id is treated as its own submission, which is the old
// behaviour — a client too old to send one is not made worse.

/** Hard ceiling on sequence probing, so a pathological loop cannot spin. */
const MAX_SNAPSHOT_SEQUENCE = 50;

/**
 * Where an attempt's claim marker lives. Server-written only: no Firestore rule
 * grants any client access, and nothing presents it to a user. It exists purely
 * so a redelivery can resolve to the record the first delivery created.
 */
const ATTEMPT_COLLECTION = 'submission_attempts';

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

    const applicationRef = db
        .collection('companies').doc(companyId)
        .collection('applications').doc(applicationId);
    const collection = applicationRef.collection('submission');

    const attemptId = typeof submissionAttemptId === 'string' && submissionAttemptId.trim()
        ? submissionAttemptId.trim()
        : null;


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

    // ---- Idempotent path: the attempt is claimed atomically. ----
    if (attemptId) {
        if (typeof db.runTransaction !== 'function') {
            // Falling back to the non-transactional claim would silently drop
            // idempotency — the one property the attempt id exists to provide.
            throw new Error('writeSubmissionSnapshot requires a Firestore that supports transactions');
        }
        const claimRef = applicationRef.collection(ATTEMPT_COLLECTION).doc(attemptId);

        const result = await db.runTransaction(async (tx) => {
            const claim = await tx.get(claimRef);
            if (claim.exists) {
                const claimed = claim.data() || {};
                return {
                    snapshotId: claimed.snapshotId,
                    sequence: claimed.sequence,
                    isOriginal: claimed.sequence === 1,
                    deduplicated: true,
                };
            }

            // All reads must precede all writes, so probe for the first free
            // sequence before writing anything.
            let sequence = null;
            for (let candidate = 1; candidate <= MAX_SNAPSHOT_SEQUENCE; candidate += 1) {
                // eslint-disable-next-line no-await-in-loop
                const existing = await tx.get(collection.doc(`v${candidate}`));
                if (!existing.exists) { sequence = candidate; break; }
            }
            if (sequence === null) {
                throw new Error(
                    `Could not claim a submission snapshot sequence for ${applicationId} `
                    + `after ${MAX_SNAPSHOT_SEQUENCE} attempts`
                );
            }

            const snapshotId = `v${sequence}`;
            tx.create(collection.doc(snapshotId), { ...payload, sequence });
            // The claim records where the attempt landed, so a redelivery that
            // arrives later resolves to the same record without a query.
            tx.create(claimRef, { snapshotId, sequence, submissionAttemptId: attemptId });
            return { snapshotId, sequence, isOriginal: sequence === 1, deduplicated: false };
        });

        console.log(
            result.deduplicated
                ? `[${logLabel}] Submission attempt ${attemptId} was already recorded as `
                    + `${result.snapshotId} for application ${applicationId} (company ${companyId}); not writing again`
                : `[${logLabel}] Wrote submission snapshot ${result.snapshotId} for application ${applicationId} (company ${companyId})`
        );
        return result;
    }

    // ---- No attempt id (or no transaction support): claim by create(). ----
    // Still safe against concurrent submissions — `create()` cannot overwrite —
    // but it cannot recognise a redelivery, which is the pre-attempt-id
    // behaviour and no worse than it.
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
    ATTEMPT_COLLECTION,
    MAX_SNAPSHOT_SEQUENCE,
    isAlreadyExists,
    readOriginalSubmissionSnapshot,
    writeSubmissionSnapshot,
};
