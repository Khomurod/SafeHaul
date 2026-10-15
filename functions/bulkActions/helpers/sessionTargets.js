// functions/bulkActions/helpers/sessionTargets.js
//
// A bulk session's recipients, in send order. A session has kept them as
// `targetIds` on its own document, up to 2,000 ids (`launchLimit.js`). That
// document is rewritten after every send (`workers/sendLoop.js`), and each
// rewrite carries the whole list to the worker's transaction and to every open
// campaign screen. The list belongs in `bulk_sessions/{id}/meta/targets`
// (`{ ids }`), written once. Every reader takes the session's own list first,
// then that document, so sessions of either shape keep sending.

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

module.exports = { sessionTargetsRef, readSessionTargetIds };
