// functions/releaseManagement/promotionStore.js
//
// The promotion records and the lock: the Admin-SDK-only collections, the
// safe-failure wrapper, the serialisable view of a stored promotion, the
// latest-promotion read, and the reconciliation of a stored promotion against
// GitHub. Extracted verbatim from `index.js`, which keeps the deployed
// callables and their options.

const { HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('../firebaseAdmin');
const { GithubRequestError, selectPromotionRun } = require('./github');
const { IneligibleReleaseError } = require('./eligibility');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../environmentVault/audit');

/**
 * Server-written promotion records. There is no Firestore rule match for this
 * collection, so no client can read or write it directly — it is Admin-SDK only,
 * exactly like `environment_audit_log`.
 */
const PROMOTIONS_COLLECTION = 'release_promotions';

/**
 * The lock lives in its OWN collection rather than as a reserved document id
 * inside `release_promotions`. A sentinel document sharing a collection with
 * real records survives only as long as every query happens to exclude it, and
 * that is not a property worth depending on.
 */
const LOCK_COLLECTION = 'release_promotion_locks';

/**
 * How long a dispatched-but-unseen promotion holds the lock.
 *
 * Long enough to cover GitHub taking a few seconds to materialise the run;
 * short enough that a dispatch which never produced a run cannot wedge releases
 * for the rest of the day.
 */
const LOCK_TTL_MS = 10 * 60 * 1000;


/** Converts an unexpected error into a safe callable failure. */
function safeFailure(error, label) {
    if (error instanceof HttpsError) return error;
    if (error instanceof IneligibleReleaseError) {
        return new HttpsError('failed-precondition', error.message);
    }
    if (error instanceof GithubRequestError) {
        console.error(`[releaseManagement] ${label} — GitHub refused`, { status: error.status });
        return new HttpsError(
            'unavailable',
            'GitHub could not be reached to run the release. Try again in a moment.',
        );
    }
    console.error(`[releaseManagement] ${label} failed`, { message: error?.message || 'unknown' });
    return new HttpsError('internal', 'That operation could not be completed.');
}


/** Plain, serialisable view of a stored promotion record. */
function serialisePromotion(doc) {
    if (!doc?.exists) return null;
    const data = doc.data() || {};
    const millis = (value) => (value && typeof value.toMillis === 'function' ? value.toMillis() : null);
    return {
        requestId: doc.id,
        kind: data.kind || 'promote',
        sha: data.sha || null,
        previousSha: data.previousSha || null,
        appVersionId: data.appVersionId || null,
        status: data.status || null,
        conclusion: data.conclusion || null,
        runId: data.runId || null,
        runUrl: data.runUrl || null,
        actorEmail: data.actorEmail || null,
        startedAt: millis(data.startedAt),
        finishedAt: millis(data.finishedAt),
    };
}

/** The most recent promotion this system started, whatever became of it. */
async function readLatestPromotion() {
    const snapshot = await db.collection(PROMOTIONS_COLLECTION)
        .orderBy('startedAt', 'desc')
        .limit(1)
        .get();
    return snapshot.empty ? null : serialisePromotion(snapshot.docs[0]);
}

/**
 * Reconciles a stored promotion against GitHub.
 *
 * A dispatch answers 204 with no run id, so the record starts as `dispatched`
 * and learns its run — and later its outcome — from here. This is also what
 * lets the audit trail record whether the promotion actually succeeded, rather
 * than only that somebody pressed the button.
 */
async function refreshPromotion(promotion, runs) {
    if (!promotion || promotion.status === 'completed') return promotion;

    const run = selectPromotionRun(runs, promotion.requestId);
    if (!run) return promotion;

    const update = {
        status: run.status,
        conclusion: run.conclusion || null,
        runId: run.runId,
        runUrl: run.htmlUrl || null,
    };

    if (run.status === 'completed') {
        update.finishedAt = admin.firestore.FieldValue.serverTimestamp();
        // A finished run must release the lock immediately. Leaving it to the TTL
        // would make a failed promotion un-retryable for ten minutes, which is
        // exactly the moment an operator most needs to act.
        await db.collection(LOCK_COLLECTION).doc('current').delete().catch(() => {});
    }

    // Claiming the outcome and persisting the update happen together, in one
    // transaction, because the Release Management screen POLLS this: two open
    // tabs — or two Super Admins — can observe the same completed run within
    // milliseconds of each other. Deciding "has anyone recorded this yet?" by
    // reading a value that was fetched before the write is exactly the read
    // -then-act race that produces two audit rows for one release. The claim
    // flag is set only if it is not already set, so precisely one caller wins.
    let claimedOutcome = false;
    const promotionRef = db.collection(PROMOTIONS_COLLECTION).doc(promotion.requestId);

    try {
        await db.runTransaction(async (tx) => {
            const snapshot = await tx.get(promotionRef);
            const stored = snapshot.exists ? snapshot.data() : {};
            claimedOutcome = run.status === 'completed' && !stored.outcomeRecorded;
            tx.set(
                promotionRef,
                claimedOutcome ? { ...update, outcomeRecorded: true } : update,
                { merge: true },
            );
        });
    } catch (error) {
        claimedOutcome = false;
        console.warn('[releaseManagement] could not persist a promotion update', {
            requestId: promotion.requestId,
            message: error?.message || 'unknown',
        });
    }

    // Record the OUTCOME once, by whoever claimed it above.
    if (claimedOutcome) {
        await recordAuditEvent({
            auth: null,
            action: ACTIONS.PROMOTE,
            result: run.conclusion === 'success' ? RESULTS.SUCCESS : RESULTS.FAILED,
            metadata: {
                requestId: promotion.requestId,
                releaseSha: promotion.sha,
                previousSha: promotion.previousSha,
                runId: run.runId,
                channel: 'production',
                reason: `promotion-${run.conclusion || 'unknown'}`,
            },
        });
    }

    return { ...promotion, ...update, finishedAt: promotion.finishedAt };
}

module.exports = {
    PROMOTIONS_COLLECTION,
    LOCK_COLLECTION,
    LOCK_TTL_MS,
    safeFailure,
    serialisePromotion,
    readLatestPromotion,
    refreshPromotion,
};
