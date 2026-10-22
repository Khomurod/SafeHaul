// functions/bulkActions/delivery/checkSessionDelivery.js
//
// Asks RingCentral what became of one SMS campaign's texts and writes the
// answer into its log. One request lists up to 1,000 of the line's sent texts,
// so a campaign of 2,000 costs a few requests, not one per text.
//
// A text RingCentral did not deliver becomes a failed log entry with the reason
// (so the report, its totals and "Retry Failed" treat it as not sent); one it
// delivered, or one still waiting, keeps its "sent" entry and records the state.

const { admin, db } = require('../../firebaseAdmin');
const SMSAdapterFactory = require('../../integrations/factory');
const {
    millisOf,
    needsDeliveryCheck,
    failureReason,
    matchLogsToRecords,
    nextDelivery,
} = require('./deliveryState');

/** Records listed around the sends, so a slow clock on either side still matches. */
const WINDOW_BEFORE_MS = 10 * 60 * 1000;
const WINDOW_AFTER_MS = 10 * 60 * 1000;
/** Log entries updated per transaction (each is one write; the limit is 500). */
const WRITE_CHUNK = 200;

function emptyCounts() {
    return { delivered: 0, failed: 0, pending: 0, unconfirmed: 0, unknown: 0 };
}

function isPermissionError(error) {
    const status = error?.response?.status;
    return status === 401 || status === 403;
}

/** Writes the changed deliveries, moving a newly failed text from the sent total to the failed one. */
async function writeDeliveries(sessionRef, changes, checkedAt) {
    for (let start = 0; start < changes.length; start += WRITE_CHUNK) {
        const chunk = changes.slice(start, start + WRITE_CHUNK);
        await db.runTransaction(async (t) => {
            const refs = chunk.map(({ logId }) => sessionRef.collection('logs').doc(logId));
            const snaps = await Promise.all(refs.map((ref) => t.get(ref)));
            let newlyFailed = 0;
            snaps.forEach((snap, index) => {
                // Another check may have settled it since this one read the log.
                if (!snap.exists || !needsDeliveryCheck(snap.data())) return;
                const { delivery } = chunk[index];
                const update = { delivery: { ...delivery, checkedAt } };
                if (delivery.state === 'failed') {
                    Object.assign(update, { status: 'failed', isSuccess: false, error: failureReason(delivery) });
                    newlyFailed++;
                }
                t.update(refs[index], update);
            });
            if (newlyFailed > 0) {
                t.update(sessionRef, {
                    'progress.successCount': admin.firestore.FieldValue.increment(-newlyFailed),
                    'progress.failedCount': admin.firestore.FieldValue.increment(newlyFailed),
                });
            }
        });
    }
}

/**
 * Checks one campaign: every log when `everyLog` (the report's button, which
 * may meet a campaign sent before deliveries were recorded), else only the
 * texts still waiting, which is all a campaign the worker queued can hold.
 * Returns `{ status, counts }`, where status is
 * 'checked', 'not_found', 'not_sms', 'nothing_to_check', 'unsupported'
 * (the line's provider keeps no message store we read), 'no_permission'
 * (the RingCentral app may not read messages) or 'error'.
 */
async function checkSessionDelivery({ companyId, sessionId, now = Date.now(), everyLog = false }) {
    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) return { status: 'not_found', counts: emptyCounts() };
    const session = sessionSnap.data();
    if (session.config?.method !== 'sms') return { status: 'not_sms', counts: emptyCounts() };

    const logs = sessionRef.collection('logs');
    const logsSnap = await (everyLog ? logs : logs.where('delivery.state', '==', 'pending')).get();
    const waiting = logsSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter(needsDeliveryCheck);
    if (waiting.length === 0) return { status: 'nothing_to_check', counts: emptyCounts() };

    const sendTimes = waiting.map((log) => millisOf(log.timestamp)).filter((ms) => ms != null);
    if (sendTimes.length === 0) return { status: 'nothing_to_check', counts: emptyCounts() };
    const dateFrom = new Date(Math.min(...sendTimes) - WINDOW_BEFORE_MS).toISOString();
    const dateTo = new Date(Math.min(now, Math.max(...sendTimes) + WINDOW_AFTER_MS)).toISOString();

    let listing;
    try {
        // The line the campaign sent from: its sender's assigned line, else the company's.
        const adapter = await SMSAdapterFactory.getAdapterForUser(companyId, session.createdBy);
        if (typeof adapter.listSentSms !== 'function') return { status: 'unsupported', counts: emptyCounts() };
        listing = await adapter.listSentSms({ dateFrom, dateTo });
    } catch (error) {
        if (isPermissionError(error)) return { status: 'no_permission', counts: emptyCounts() };
        console.error(`[smsDelivery] Could not list the sent texts of campaign ${sessionId}:`, error.message);
        return { status: 'error', counts: emptyCounts(), message: error.message };
    }

    const matches = matchLogsToRecords(waiting, listing.records);
    const counts = emptyCounts();
    const changes = [];
    for (const log of waiting) {
        const next = nextDelivery(log, matches.get(log.id), { now, listedEverything: listing.complete });
        const delivery = next || log.delivery || { state: 'pending' };
        counts[delivery.state] = (counts[delivery.state] || 0) + 1;
        if (next) changes.push({ logId: log.id, delivery: next });
    }
    await writeDeliveries(sessionRef, changes, admin.firestore.Timestamp.fromMillis(now));
    if (changes.length > 0) {
        await sessionRef.update({ deliveryCheckedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    return { status: 'checked', counts };
}

module.exports = { checkSessionDelivery };
