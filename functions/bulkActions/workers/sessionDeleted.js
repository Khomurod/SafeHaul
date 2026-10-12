// functions/bulkActions/workers/sessionDeleted.js
//
// A campaign record deleted from the dashboard takes its report with it: the
// session's `logs`, one per recipient, and, for an uploaded list, its `targets`,
// the rows as uploaded. The browser deletes only the session document, and
// Firestore keeps a deleted document's subcollections, so the people a campaign
// messaged stayed on file after "permanently deleted".
//
// A retry reads its uploaded rows from the session it retried
// (`importSourceSessionId`), and so does a retry of that retry. Those rows stay
// while any session still reads them; the deletion of the last one takes them.
// A retry started while its session is being deleted gives itself up
// (`retryFailedAttempts`), so no new reader can appear after the check below.
//
// Once the session document is gone nothing else would finish the cleanup, and
// the platform does not retry this function (`deployedEntryPoint.test.js`), so a
// try that fails is tried again here, twice, a few seconds apart.

const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { db } = require("../../firebaseAdmin");

/** The waits before the second and the third try. */
const RETRY_WAITS_MS = Object.freeze([3000, 12000]);

/** Replaced by the tests, which have no seconds to spend. */
const timing = { wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }) };

async function deleteSessionData(companyId, sessionId, importSourceSessionId) {
    const sessions = db.collection("companies").doc(companyId).collection("bulk_sessions");

    await db.recursiveDelete(sessions.doc(sessionId).collection("logs"));

    const sourceId = importSourceSessionId || sessionId;
    const [source, readers] = await Promise.all([
        sessions.doc(sourceId).get(),
        sessions.where("importSourceSessionId", "==", sourceId).limit(1).get(),
    ]);
    if (source.exists || !readers.empty) return;
    await db.recursiveDelete(sessions.doc(sourceId).collection("targets"));
}

exports.deleteBulkSessionData = onDocumentDeleted({
    document: "companies/{companyId}/bulk_sessions/{sessionId}",
    region: "us-central1",
    // Two subcollections of up to 2,000 documents each (`launchLimit.js`), and
    // the waits between three tries.
    timeoutSeconds: 300,
}, async (event) => {
    const { companyId, sessionId } = event.params;
    const importSourceSessionId = event.data?.data()?.importSourceSessionId;
    for (let attempt = 0; ; attempt += 1) {
        try {
            await deleteSessionData(companyId, sessionId, importSourceSessionId);
            return;
        } catch (err) {
            if (attempt === RETRY_WAITS_MS.length) {
                console.error(`[deleteBulkSessionData] ${companyId}/${sessionId}: cleanup failed after ${attempt + 1} tries:`, err);
                throw err;
            }
            await timing.wait(RETRY_WAITS_MS[attempt]);
        }
    }
});

exports.__private = { RETRY_WAITS_MS, timing };
