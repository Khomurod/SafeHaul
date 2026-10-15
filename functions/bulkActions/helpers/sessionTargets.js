// functions/bulkActions/helpers/sessionTargets.js
//
// A bulk session's recipients, in send order: up to 2,000 ids
// (`launchLimit.js`) in `bulk_sessions/{id}/meta/targets` (`{ ids }`), written
// once, with the session. The session document itself is rewritten after
// every send (`workers/sendLoop.js`), and each rewrite reaches the worker's
// transaction and every open campaign screen, so the list stays off it.
// Sessions written before kept it as `targetIds` on their own document; every
// reader takes that first, then `meta/targets`.

const { db } = require('../../firebaseAdmin');

function sessionTargetsRef(sessionRef) {
    return sessionRef.collection('meta').doc('targets');
}

/**
 * The session's recipient ids: its own `targetIds`, else `meta/targets`, else
 * none. Pass the transaction when reading inside one.
 */
async function readSessionTargetIds(sessionRef, sessionData, transaction) {
    if (Array.isArray(sessionData?.targetIds)) return sessionData.targetIds;
    const ref = sessionTargetsRef(sessionRef);
    const snap = transaction ? await transaction.get(ref) : await ref.get();
    const ids = snap.exists ? snap.data()?.ids : null;
    return Array.isArray(ids) ? ids : [];
}

/**
 * Write a new session and its recipients in one batch: no reader sees the
 * session without its list.
 */
async function writeNewSession(sessionRef, sessionData, targetIds) {
    const batch = db.batch();
    batch.set(sessionRef, sessionData);
    batch.set(sessionTargetsRef(sessionRef), { ids: targetIds });
    await batch.commit();
}

module.exports = { sessionTargetsRef, readSessionTargetIds, writeNewSession };
