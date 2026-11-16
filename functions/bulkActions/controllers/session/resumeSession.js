// functions/bulkActions/controllers/session/resumeSession.js
//
// Resume (a paused campaign) and Continue (a campaign that stopped with an
// error part-way) are one action: the session goes back to `active` and the
// worker carries on from `progress.currentPointer`, so no one already tried is
// messaged again. Decided in one transaction, so two clicks, or a click racing
// the worker, cannot start two workers or restart a finished session.

const { HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../../firebaseAdmin");
const { readSessionTargetIds } = require("../../helpers/sessionTargets");

/**
 * The statuses a session continues from: a pause, or a failure that stopped it
 * before every recipient was tried (a provider refusal at a batch's start, a
 * queue that would not start). Anything else is refused, so no direct call can
 * restart a cancelled or completed campaign, or start a second worker beside a
 * running one.
 */
const RESUMABLE = new Set(['paused', 'failed']);

/**
 * Returns `{ generation }`, the worker generation to enqueue, when the session
 * is active again with recipients left; `{ completed: true, message }` when it
 * had none left and is now completed. Throws `failed-precondition` when the
 * session cannot continue, `not-found` when it is gone.
 */
async function claimResume(sessionRef, uid) {
    return db.runTransaction(async (t) => {
        const snap = await t.get(sessionRef);
        if (!snap.exists) throw new HttpsError('not-found', 'Session not found.');
        const data = snap.data() || {};

        if (!RESUMABLE.has(data.status)) {
            throw new HttpsError(
                'failed-precondition',
                `This campaign is ${data.status || 'not started'}; only a paused or stopped campaign can continue.`,
            );
        }

        // Defensive: older or failed sessions may lack `progress` or a recipient list.
        const pointer = data.progress?.currentPointer ?? 0;
        const total = (await readSessionTargetIds(sessionRef, data, t)).length;
        const now = admin.firestore.FieldValue.serverTimestamp();

        // Everyone was tried already: there is nothing to continue, so the
        // session is done rather than left `active` with no worker.
        if (total === 0 || pointer >= total) {
            t.update(sessionRef, { status: 'completed', completedAt: now, updatedBy: uid, lastUpdateAt: now });
            return {
                completed: true,
                message: total === 0
                    ? 'No remaining targets — session marked complete.'
                    : 'Every recipient was already tried — campaign marked complete.',
            };
        }

        // A new generation: a worker still holding the old one exits on its next batch.
        const generation = (typeof data.workerGeneration === 'number' ? data.workerGeneration : 0) + 1;
        t.update(sessionRef, { status: 'active', updatedBy: uid, lastUpdateAt: now, workerGeneration: generation });
        return { generation };
    });
}

module.exports = { claimResume };
