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
 *
 * A run that could not finish fails, and the platform runs it again (`retry`)
 * with the draft as it was. Nothing else could: the draft is gone, and another
 * deletion may never come at that company. Retries last 24 hours, so a run 12
 * hours after the deletion is the last: it records what is still left for the
 * next deletion at the company, as a purge does, and stops.
 */

const { onDocumentDeletedWithAuthContext } = require('firebase-functions/v2/firestore');
const { deleteDraftFiles, retryPendingFiles } = require('./draftFiles');

/** After this long the platform's retries are nearly over, so a run is the last. */
const LAST_RUN_AFTER_MS = 12 * 60 * 60 * 1000;

/** Was this the TTL policy deleting a draft that had expired? */
function expiredByTtl(event, data, now = Date.now()) {
    const expiresAt = data?.expiresAt?.toMillis?.();
    return event?.authType === 'system' && Number.isFinite(expiresAt) && expiresAt <= now;
}

/** Will the platform run this again if it fails? Not once it is old, or of unknown age. */
function retriesLeft(event, now = Date.now()) {
    const age = now - Date.parse(event?.time);
    return Number.isFinite(age) && age < LAST_RUN_AFTER_MS;
}

exports.deleteExpiredDraftFiles = onDocumentDeletedWithAuthContext({
    document: 'companies/{companyId}/application_drafts/{applicantKey}',
    region: 'us-central1',
    retry: true,
}, async (event) => {
    const data = event.data?.data();
    if (!expiredByTtl(event, data)) return;
    const { companyId, applicantKey } = event.params;
    const retrying = retriesLeft(event);
    // Never throws: what fails is counted, and recorded only by the last run.
    const files = await deleteDraftFiles(companyId, [{ key: applicantKey, data }], { recordFailures: !retrying });
    if (files.deleted + files.kept + files.failed > 0) {
        console.info(`[deleteExpiredDraftFiles] ${companyId}: ${files.deleted} file(s) deleted; ${files.kept} kept, ${files.failed} left`);
    }
    if (files.failed > 0) {
        if (retrying) throw new Error(`[deleteExpiredDraftFiles] ${companyId}: ${files.failed} file(s) left; running again`);
        return;
    }
    // What earlier deletions here could not finish, by a run that went through: a
    // run that failed would most likely fail them too, and spend their attempts.
    await retryPendingFiles(companyId);
});

exports.__private = { LAST_RUN_AFTER_MS, expiredByTtl, retriesLeft };
