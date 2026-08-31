// functions/releaseManagement/promote.js
//
// The shared promotion engine behind both promoting callables. The ONLY
// difference between promoting and rolling back is which candidate the
// caller's `resolveCandidate` picks — never a SHA from the request. Extracted
// verbatim from `index.js`, which keeps the deployed callables, their options
// and their candidate resolvers.

const { HttpsError } = require('firebase-functions/v2/https');
const { randomUUID } = require('node:crypto');
const { admin, db } = require('../firebaseAdmin');
const { RESULTS, recordAuditEvent } = require('../environmentVault/audit');
const { guardPrivileged } = require('../environmentVault/guards');
const {
    readReleaseStatus,
    resolveTestingRelease,
} = require('./eligibility');
const {
    createReleaseApi,
    dispatchPromotion,
    findRunningPromotion,
    isCredentialConfigured,
} = require('./github');
const {
    PROMOTIONS_COLLECTION,
    LOCK_COLLECTION,
    LOCK_TTL_MS,
    safeFailure,
} = require('./promotionStore');

/** Refuses early, and identically, when the release credential is absent. */
function assertCredentialConfigured() {
    if (isCredentialConfigured()) return;
    throw new HttpsError(
        'failed-precondition',
        'Release Management is not connected to the deployment pipeline yet. ' +
        'The release credential has not been configured for this environment.',
    );
}

/**
 * Shared body for both promoting callables.
 *
 * `resolveCandidate` is the ONLY difference between promoting and rolling back:
 * one picks the eligible Testing release, the other picks the previous
 * successful Production release. Neither reads a SHA from the request.
 */
async function startPromotion(request, { kind, action, resolveCandidate }) {
    await guardPrivileged(request, 'promote', action, { channel: 'production' }, 'release');
    assertCredentialConfigured();

    const api = createReleaseApi();
    const reason = typeof request.data?.reason === 'string'
        ? request.data.reason.slice(0, 300)
        : undefined;

    let state;
    try {
        state = await readReleaseStatus({ api });
    } catch (error) {
        throw safeFailure(error, kind);
    }

    const candidateSha = resolveCandidate(state);
    if (!candidateSha) {
        await recordAuditEvent({
            auth: request.auth,
            action,
            result: RESULTS.DENIED,
            metadata: { channel: 'production', reason: 'no-candidate' },
        });
        throw new HttpsError(
            'failed-precondition',
            kind === 'rollback'
                ? 'There is no previous Production release on record to roll back to.'
                : 'There is no tested release available to promote yet.',
        );
    }

    // The confirmation the operator saw named a specific release. If a new
    // Testing release landed between that dialog and this request, the thing
    // they approved is no longer what would ship — so this refuses rather than
    // silently promoting something they never saw. The client's SHA is used ONLY
    // for this comparison; it is never what gets promoted.
    const expectedSha = request.data?.expectedSha;
    if (typeof expectedSha === 'string' && expectedSha !== candidateSha) {
        await recordAuditEvent({
            auth: request.auth,
            action,
            result: RESULTS.DENIED,
            metadata: {
                channel: 'production',
                releaseSha: candidateSha,
                reason: 'candidate-changed',
            },
        });
        throw new HttpsError(
            'failed-precondition',
            'The tested release changed while you were confirming. Refresh and review the new release before releasing it.',
        );
    }

    // Independent re-verification. `readReleaseStatus` decided what to SHOW;
    // this decides what may SHIP, from the same rules the release runner will
    // apply again a moment later.
    let resolved;
    try {
        resolved = await resolveTestingRelease({ candidateSha, api });
    } catch (error) {
        await recordAuditEvent({
            auth: request.auth,
            action,
            result: RESULTS.DENIED,
            metadata: {
                channel: 'production',
                releaseSha: candidateSha,
                reason: 'ineligible',
            },
        });
        throw safeFailure(error, kind);
    }

    if (resolved.alreadyLive) {
        await recordAuditEvent({
            auth: request.auth,
            action,
            result: RESULTS.SUCCESS,
            metadata: {
                channel: 'production',
                releaseSha: candidateSha,
                reason: 'already-live',
            },
        });
        return { status: 'already-live', sha: candidateSha, requestId: null };
    }

    // A promotion GitHub is already running wins. Checking this before taking the
    // local lock means an incident responder's manual dispatch is respected too.
    const running = await findRunningPromotion();
    if (running) {
        throw new HttpsError(
            'aborted',
            'A release is already running. Wait for it to finish before starting another.',
        );
    }

    const requestId = randomUUID();
    const previousSha = state.production?.sha || null;

    // Local lock, taken in a transaction, so two tabs or a double-click cannot
    // both get past the GitHub check in the seconds before a run exists.
    const lockRef = db.collection(LOCK_COLLECTION).doc('current');
    try {
        await db.runTransaction(async (tx) => {
            const snapshot = await tx.get(lockRef);
            const held = snapshot.exists ? snapshot.data() : null;
            const heldAt = held?.takenAt?.toMillis?.();

            // A lock whose timestamp cannot be read counts as HELD. The
            // alternative — treating an unreadable lock as free — is a gate that
            // opens when it is confused, and this gate decides what end users
            // are served. It cannot wedge: a completed or failed run deletes the
            // lock, and the TTL clears an abandoned one.
            const stillHeld = held?.requestId
                && (!Number.isFinite(heldAt) || Date.now() - heldAt < LOCK_TTL_MS);

            if (stillHeld) {
                throw new HttpsError(
                    'aborted',
                    'A release was just started. Wait for it to finish before starting another.',
                );
            }

            tx.set(lockRef, {
                requestId,
                sha: candidateSha,
                takenAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        });
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw safeFailure(error, kind);
    }

    await db.collection(PROMOTIONS_COLLECTION).doc(requestId).set({
        kind,
        sha: candidateSha,
        previousSha,
        appVersionId: resolved.appVersionId,
        status: 'dispatched',
        conclusion: null,
        runId: null,
        runUrl: null,
        actorUid: request.auth.uid,
        actorEmail: typeof request.auth.token?.email === 'string' ? request.auth.token.email : null,
        reason: reason || null,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
        await dispatchPromotion({ sha: candidateSha, reason, requestId });
    } catch (error) {
        // The dispatch never happened, so the lock must not survive it.
        await lockRef.delete().catch(() => {});
        await db.collection(PROMOTIONS_COLLECTION).doc(requestId).set(
            { status: 'completed', conclusion: 'dispatch-failed', finishedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true },
        );
        await recordAuditEvent({
            auth: request.auth,
            action,
            result: RESULTS.FAILED,
            metadata: {
                channel: 'production',
                releaseSha: candidateSha,
                requestId,
                reason: 'dispatch-failed',
            },
        });
        throw safeFailure(error, kind);
    }

    await recordAuditEvent({
        auth: request.auth,
        action,
        result: RESULTS.SUCCESS,
        metadata: {
            channel: 'production',
            releaseSha: candidateSha,
            previousSha,
            appVersionId: resolved.appVersionId,
            requestId,
            reason: kind,
        },
    });

    return {
        status: 'dispatched',
        requestId,
        sha: candidateSha,
        previousSha,
        appVersionId: resolved.appVersionId,
    };
}

module.exports = {
    assertCredentialConfigured,
    startPromotion,
};
