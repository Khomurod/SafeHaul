/**
 * Super Admin "Release Management" — callable surface.
 *
 * Three narrow callables. Together they are the only way a human can change what
 * app.safehaul.io serves, and every one of them is built on the same rule:
 *
 *   THE BROWSER NEVER NAMES THE RELEASE.
 *
 * A promotion request carries no commit SHA that the server acts on. The server
 * resolves the authoritative candidate itself, from GitHub Deployment records
 * that only GitHub Actions can write, and re-verifies its eligibility from
 * scratch immediately before dispatching. A client that edits its own payload
 * can, at most, cause its own request to be refused.
 *
 * ## Contract shared by all three
 *
 *  - authenticated, and exactly `globalRole === 'super_admin'`;
 *  - company admins and ordinary users are rejected, not degraded;
 *  - the two promoting callables additionally require recent authentication;
 *  - per-caller, fail-closed rate limits;
 *  - no GitHub or Google credential is ever returned, logged or echoed;
 *  - a value-free audit record for every promotion, including denials.
 *
 * ## Why status reads are not audited
 *
 * The Release Management screen polls `getReleaseStatus` while a promotion runs.
 * Recording every poll would bury the records that matter — who promoted what —
 * under thousands of reads of public release identifiers. Denials ARE recorded,
 * by the guards themselves, so an attempt to reach this surface without
 * authority is still visible.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { randomUUID } = require('node:crypto');
const { admin, db } = require('../firebaseAdmin');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../environmentVault/audit');
const { assertSuperAdmin, assertWithinRateLimit, guardPrivileged } = require('../environmentVault/guards');
const {
    IneligibleReleaseError,
    readReleaseStatus,
    resolveTestingRelease,
} = require('./eligibility');
const {
    GithubRequestError,
    SECRET_NAMES,
    createReleaseApi,
    dispatchPromotion,
    findRunningPromotion,
    isCredentialConfigured,
    listPromotionRuns,
    selectPromotionRun,
    selectRunningPromotion,
} = require('./github');

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

const releaseOptions = {
    cors: true,
    secrets: SECRET_NAMES,
};

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

/** Refuses early, and identically, when the release credential is absent. */
function assertCredentialConfigured() {
    if (isCredentialConfigured()) return;
    throw new HttpsError(
        'failed-precondition',
        'Release Management is not connected to the deployment pipeline yet. ' +
        'The release credential has not been configured for this environment.',
    );
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

    try {
        await db.collection(PROMOTIONS_COLLECTION).doc(promotion.requestId).set(update, { merge: true });
    } catch (error) {
        console.warn('[releaseManagement] could not persist a promotion update', {
            requestId: promotion.requestId,
            message: error?.message || 'unknown',
        });
    }

    // Record the OUTCOME once, the first time it is observed.
    if (run.status === 'completed' && promotion.status !== 'completed') {
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

/**
 * 1. The whole release picture the Super Admin screen renders.
 *
 * Everything returned here is a public release identifier: commit SHAs, Firebase
 * Hosting version ids, a GitHub run id and timestamps. There is deliberately no
 * path through this callable that can surface an environment value, a token or
 * anything about the release credential beyond whether one exists.
 */
exports.getReleaseStatus = onCall(releaseOptions, async (request) => {
    await assertSuperAdmin(request, ACTIONS.RELEASE_STATUS);
    await assertWithinRateLimit(request, 'releaseStatus', ACTIONS.RELEASE_STATUS, {}, 'release');

    if (!isCredentialConfigured()) {
        return {
            configured: false,
            message:
                'Release Management is not connected to the deployment pipeline yet. ' +
                'A release credential must be configured before releases can be promoted from here.',
            testing: null,
            production: null,
            previousProduction: null,
            activePromotion: null,
            latestPromotion: await readLatestPromotion().catch(() => null),
            generatedAt: Date.now(),
        };
    }

    try {
        const api = createReleaseApi();
        const state = await readReleaseStatus({ api });

        // One request answers both "is a release running" and "what became of
        // the last one we started". A transient failure here must not turn a
        // running release into a failed one, so it degrades to "no run
        // information" and leaves the stored record as it was.
        let runs = [];
        try {
            runs = await listPromotionRuns();
        } catch (error) {
            console.warn('[releaseManagement] could not read promotion runs', {
                message: error?.message || 'unknown',
            });
        }

        const latest = await refreshPromotion(await readLatestPromotion(), runs);
        const running = selectRunningPromotion(runs);

        return {
            configured: true,
            ...state,
            // `running` is GitHub's own answer, so a promotion started by any
            // route — this screen, or a manual dispatch during an incident —
            // shows up here and blocks a second one.
            activePromotion: running,
            latestPromotion: latest,
            generatedAt: Date.now(),
        };
    } catch (error) {
        throw safeFailure(error, 'getReleaseStatus');
    }
});

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

/**
 * 2. Promote the currently eligible tested release to Production.
 *
 * The candidate is whatever `readReleaseStatus` reports as the eligible Testing
 * release — never a SHA from the request.
 */
exports.promoteTestingToProduction = onCall(releaseOptions, (request) => startPromotion(request, {
    kind: 'promote',
    action: ACTIONS.PROMOTE,
    resolveCandidate: (state) => (state.testing?.eligible ? state.testing.sha : null),
}));

/**
 * 3. Roll Production back to the previous release.
 *
 * The candidate is the previous SUCCESSFUL Production release on record, chosen
 * by the server. It goes through exactly the same eligibility gate as a forward
 * promotion, and is delivered the same way: the immutable Hosting version that
 * release originally produced is cloned back onto the production site.
 *
 * What this does NOT do, and what the confirmation dialog says plainly: it does
 * not roll back the shared backend. Cloud Functions, Firestore rules, Storage
 * rules, indexes and all business data are shared with Testing and stay where
 * they are. This is a frontend rollback, and it is only safe because the release
 * discipline requires backend changes to remain backward compatible with the
 * frontend currently live on production.
 */
exports.rollbackProductionRelease = onCall(releaseOptions, (request) => startPromotion(request, {
    kind: 'rollback',
    action: ACTIONS.PROMOTE,
    resolveCandidate: (state) => state.previousProduction?.sha || null,
}));
