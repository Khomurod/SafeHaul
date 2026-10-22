// functions/bulkActions/delivery/deliveryQueue.js
//
// SMS campaigns waiting for RingCentral to report what became of their texts.
// The worker queues a campaign after each batch that sent a text; the scheduled
// check (`deliveryCheck.js`) takes the campaigns that are due and puts each one
// back until every text has a final state. Only the server reads or writes it.

const { admin, db } = require('../../firebaseAdmin');

const FIRST_CHECK_DELAY_MS = 5 * 60 * 1000;
const RECHECK_DELAY_MS = 15 * 60 * 1000;
const ERROR_RETRY_DELAY_MS = 60 * 60 * 1000;
/** A campaign whose check keeps failing leaves the queue after this many tries. */
const MAX_ERRORS = 24;

const queue = () => db.collection('system_jobs').doc('smsDelivery').collection('sessions');
const entryId = (companyId, sessionId) => `${companyId}__${sessionId}`;
const dueIn = (ms) => admin.firestore.Timestamp.fromMillis(Date.now() + ms);

/** Queues (or moves) a campaign's check to `delayMs` from now. */
async function queueDeliveryCheck(companyId, sessionId, delayMs = FIRST_CHECK_DELAY_MS) {
    await queue().doc(entryId(companyId, sessionId)).set({
        companyId,
        sessionId,
        dueAt: dueIn(delayMs),
        errors: 0,
    }, { merge: true });
}

/** The campaigns whose check is due, oldest first. */
async function dueDeliveryChecks(limit) {
    const snap = await queue()
        .where('dueAt', '<=', admin.firestore.Timestamp.now())
        .orderBy('dueAt')
        .limit(limit)
        .get();
    return snap.docs.map((doc) => ({ ref: doc.ref, ...doc.data() }));
}

/**
 * After a check: back in the queue while texts wait, out when all are settled.
 * A failed check, or one RingCentral refused for want of the Read Messages
 * permission, is tried again hourly, so turning the permission on is enough.
 */
async function settleDeliveryCheck(entry, result) {
    if (result.status === 'error' || result.status === 'no_permission') {
        const errors = (entry.errors || 0) + 1;
        if (errors >= MAX_ERRORS) return entry.ref.delete();
        return entry.ref.set({ dueAt: dueIn(ERROR_RETRY_DELAY_MS), errors }, { merge: true });
    }
    if (result.status === 'checked' && result.counts.pending > 0) {
        return entry.ref.set({ dueAt: dueIn(RECHECK_DELAY_MS), errors: 0 }, { merge: true });
    }
    return entry.ref.delete();
}

module.exports = {
    FIRST_CHECK_DELAY_MS,
    RECHECK_DELAY_MS,
    MAX_ERRORS,
    queueDeliveryCheck,
    dueDeliveryChecks,
    settleDeliveryCheck,
};
