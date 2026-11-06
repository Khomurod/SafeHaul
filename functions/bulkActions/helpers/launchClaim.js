const { HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");

/**
 * One launch per campaign draft. `initBulkSession` claims the draft
 * (`companies/{companyId}/campaign_drafts/{campaignId}`) in a transaction
 * before it gathers recipients, so two tabs, or two people, pressing Launch on
 * the same draft send one campaign:
 *
 * - a draft with `launchedAt` is refused (already launched);
 * - a draft whose `launchClaim` is younger than `CLAIM_TTL_MS` is refused (a
 *   launch is running). An older claim belongs to a launch that died, since
 *   the callable stops after 540 seconds, and is taken over;
 * - a launch that goes out marks the draft (`launchedAt`, `sessionId`) and
 *   drops the claim; one that fails gives its own claim back.
 *
 * A screen that sends no draft (Production's screens until a release ships
 * this) claims nothing and launches as before.
 */

const CLAIM_TTL_MS = 10 * 60 * 1000;

const ALREADY_LAUNCHED = 'This campaign was already launched. Open its report from Campaigns.';
const LAUNCH_RUNNING = 'This campaign is being launched in another tab or by a teammate. '
    + 'Wait a minute, then check Campaigns.';
const DRAFT_GONE = 'This campaign was deleted. Go back to Campaigns and start a new one.';

/** A Firestore document id a screen could have created: not a path, not reserved. */
function isDraftId(value) {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= 200
        && !value.includes('/')
        && value !== '.'
        && value !== '..'
        && !/^__.*__$/.test(value);
}

function claimedAtMillis(claim) {
    const millis = typeof claim?.at?.toMillis === 'function' ? claim.at.toMillis() : NaN;
    return Number.isFinite(millis) ? millis : 0;
}

/**
 * Claims the draft for this launch. Returns the draft's reference, or `null`
 * when the screen named no draft. Throws an `HttpsError` the screen shows as
 * it is.
 */
async function claimDraftLaunch({ companyId, campaignId, uid, sessionId, now = Date.now() }) {
    if (campaignId === undefined || campaignId === null) return null;
    if (!isDraftId(campaignId)) throw new HttpsError('invalid-argument', 'This campaign could not be found.');

    const draftRef = db.collection('companies').doc(companyId).collection('campaign_drafts').doc(campaignId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(draftRef);
        if (!snap.exists) throw new HttpsError('not-found', DRAFT_GONE);
        const draft = snap.data() || {};
        if (draft.launchedAt) throw new HttpsError('failed-precondition', ALREADY_LAUNCHED);
        if (draft.launchClaim && now - claimedAtMillis(draft.launchClaim) < CLAIM_TTL_MS) {
            throw new HttpsError('failed-precondition', LAUNCH_RUNNING);
        }
        tx.update(draftRef, {
            launchClaim: { by: uid, sessionId, at: admin.firestore.Timestamp.fromMillis(now) },
        });
    });
    return draftRef;
}

/**
 * The launch went out: the draft becomes its record. A failure here is logged
 * and never fails the launch, which has already started sending.
 */
async function finishDraftLaunch(draftRef, sessionId) {
    if (!draftRef) return;
    try {
        await draftRef.update({
            launchedAt: admin.firestore.FieldValue.serverTimestamp(),
            sessionId,
            launchClaim: admin.firestore.FieldValue.delete(),
        });
    } catch (error) {
        console.error('[launchClaim] Could not mark the draft launched:', error?.code ?? 'unknown');
    }
}

/**
 * The launch did not go out: its claim is given back, so the draft can be
 * launched again. Another launch's claim is left alone, and a failure is only
 * logged, so it never hides the launch's own error.
 */
async function releaseDraftLaunch(draftRef, sessionId) {
    if (!draftRef) return;
    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(draftRef);
            if (snap.exists && snap.data()?.launchClaim?.sessionId === sessionId) {
                tx.update(draftRef, { launchClaim: admin.firestore.FieldValue.delete() });
            }
        });
    } catch (error) {
        console.error('[launchClaim] Could not release the draft:', error?.code ?? 'unknown');
    }
}

module.exports = { CLAIM_TTL_MS, claimDraftLaunch, finishDraftLaunch, releaseDraftLaunch };
