/**
 * PEV — which requests are still live, and closing them.
 *
 * A request is **live** while it can draw a reminder or the day-30 "no response"
 * mark: `sent`, `opened`, `reminder_sent` (the reminder query, ./reminders.js).
 * Every other status is closed for that cycle:
 * - `completed` — the employer answered in the portal, or the company uploaded
 *   the result (./manualResult.js);
 * - `no_response` — day 30 passed with no answer (an uploaded late result can
 *   still complete it);
 * - `send_failed` — the first email never went out, so nothing was attempted;
 * - `superseded` — a newer request for the same employer replaced it;
 * - `processing` — a portal answer in flight, left to finish (./responses.js).
 *
 * A status moves only from the one it was read with, inside a transaction, so a
 * closing write never lands on an answer that arrived a moment earlier.
 */
const crypto = require('crypto');
const { db } = require('../firebaseAdmin');
const { resolveEmployerTarget } = require('../shared/employerIdentity');

const LIVE_STATUSES = Object.freeze(['sent', 'opened', 'reminder_sent']);

/** What the portal answers for a link a newer request replaced, on opening and on submitting. */
const SUPERSEDED_MESSAGE = 'This request was replaced by a newer one. Please use the most recent email you received.';

/**
 * The request's name in records the team can read (a notification's id). Never
 * the portal token, which answers as the employer (PEV-SEC-3): a request sent
 * before `requestId` was kept is named by a hash of its token instead.
 */
function requestIdOf(request, token) {
    if (typeof request?.requestId === 'string' && request.requestId) return request.requestId;
    return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
}

/**
 * Applies `update` when the request's status is still one of `from`.
 *
 * @returns {Promise<boolean>} whether it was applied
 */
async function updateWhileStatus(ref, from, update) {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || !from.includes(snap.data()?.status)) return false;
        tx.update(ref, update);
        return true;
    });
}

/**
 * The requests filed against one employer row: those this record holds whose
 * employer resolves to `index` in `employers` (by identity, or the legacy
 * index-and-name rule of `resolveEmployerTarget`).
 */
async function requestsForEmployer({ companyId, collectionName, applicationId }, employers, index) {
    const snap = await db.collection('verification_requests').where('applicationId', '==', applicationId).get();
    return snap.docs.filter((doc) => {
        const request = doc.data() || {};
        if (request.companyId !== companyId) return false;
        if ((request.collectionName || 'applications') !== collectionName) return false;
        return resolveEmployerTarget(employers, request)?.index === index;
    });
}

/**
 * Moves each of `docs` still in one of `from` to `update`.
 *
 * @returns {Promise<number>} how many moved
 */
async function closeRequests(docs, from, update) {
    let closed = 0;
    for (const doc of docs) {
        if (await updateWhileStatus(doc.ref, from, update)) closed += 1;
    }
    return closed;
}

module.exports = {
    LIVE_STATUSES, SUPERSEDED_MESSAGE, closeRequests, requestIdOf, requestsForEmployer, updateWhileStatus,
};
