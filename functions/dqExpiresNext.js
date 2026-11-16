/**
 * onDqFileWritten — keeps an application's or lead's `dqExpiresNext` true to its
 * DQ file (`shared/dqExpiry.js`).
 *
 * Every DQ write runs it: a driver's upload filed, a team upload, a valid-until
 * date set or cleared, a removal, a deletion, and the dates
 * `onApplicationUpdated` copies from the application. It reads nothing when the
 * written record's own date was not and is not part of the earliest — no date
 * before or after, or the same date and the same removed state — so most DQ
 * writes cost one invocation and nothing more. Only `applications` and `leads`
 * hold DQ files; any other path under a company is ignored.
 */

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { db } = require('./firebaseAdmin');
const { expiryContribution, refreshDqExpiresNext } = require('./shared/dqExpiry');

const RECORD_COLLECTIONS = Object.freeze(['applications', 'leads']);

exports.onDqFileWritten = onDocumentWritten({
    document: 'companies/{companyId}/{collectionName}/{recordId}/dq_files/{fileId}',
    maxInstances: 5,
}, async (event) => {
    const { companyId, collectionName, recordId, fileId } = event.params;
    if (!RECORD_COLLECTIONS.includes(collectionName)) return;
    const before = event.data?.before?.data?.() || null;
    const after = event.data?.after?.data?.() || null;
    if (expiryContribution(before) === expiryContribution(after)) return;

    const recordRef = db.collection('companies').doc(companyId).collection(collectionName).doc(recordId);
    try {
        await refreshDqExpiresNext(recordRef);
    } catch (error) {
        // Not retried: the next DQ write that can move it, or the DQ tab's next
        // opening (`syncDqFiles`), puts it right.
        console.error(`[onDqFileWritten] Could not update dqExpiresNext of ${collectionName}/${recordId} after ${fileId}:`, error);
    }
});
