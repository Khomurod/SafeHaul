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

const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { db } = require("../../firebaseAdmin");

exports.deleteBulkSessionData = onDocumentDeleted({
    document: "companies/{companyId}/bulk_sessions/{sessionId}",
    region: "us-central1",
    // Two subcollections of up to 2,000 documents each (`launchLimit.js`).
    timeoutSeconds: 300,
}, async (event) => {
    const { companyId, sessionId } = event.params;
    const sessions = db.collection("companies").doc(companyId).collection("bulk_sessions");

    await db.recursiveDelete(sessions.doc(sessionId).collection("logs"));

    const sourceId = event.data?.data()?.importSourceSessionId || sessionId;
    const [source, readers] = await Promise.all([
        sessions.doc(sourceId).get(),
        sessions.where("importSourceSessionId", "==", sourceId).limit(1).get(),
    ]);
    if (source.exists || !readers.empty) return;
    await db.recursiveDelete(sessions.doc(sourceId).collection("targets"));
});
