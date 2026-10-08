/**
 * The files of an unfinished application that expired.
 *
 * A draft lives 30 days after its last save, and then Firestore's TTL policy
 * deletes it (`expiresAt`). Its uploads used to stay in Storage for good. They now
 * go with it, by the rules a Company Admin's deletion follows (`draftFiles.js`):
 * only the company's upload paths, and none that another unfinished application,
 * a submitted application, its DQ files or its snapshots still use.
 *
 * Only the TTL policy's own deletion counts: `authType` `system`, on a draft whose
 * `expiresAt` has passed. The functions delete drafts too, as their service
 * account, and leave the files: a submitted application or a superseding draft
 * still uses them, and Start Over leaves them as it always has.
 */

const { onDocumentDeletedWithAuthContext } = require('firebase-functions/v2/firestore');
const { deleteDraftFiles, retryPendingFiles } = require('./draftFiles');

/** Was this the TTL policy deleting a draft that had expired? */
function expiredByTtl(event, data, now = Date.now()) {
    const expiresAt = data?.expiresAt?.toMillis?.();
    return event?.authType === 'system' && Number.isFinite(expiresAt) && expiresAt <= now;
}

exports.deleteExpiredDraftFiles = onDocumentDeletedWithAuthContext({
    document: 'companies/{companyId}/application_drafts/{applicantKey}',
    region: 'us-central1',
}, async (event) => {
    const data = event.data?.data();
    if (!expiredByTtl(event, data)) return;
    const { companyId, applicantKey } = event.params;
    // Neither throws: what could not be done is recorded for the next deletion.
    await retryPendingFiles(companyId);
    const files = await deleteDraftFiles(companyId, [{ key: applicantKey, data }]);
    if (files.deleted + files.kept + files.failed > 0) {
        console.info(`[deleteExpiredDraftFiles] ${companyId}: ${files.deleted} file(s) deleted; ${files.kept} kept, ${files.failed} left`);
    }
});

exports.__private = { expiredByTtl };
