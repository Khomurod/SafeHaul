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
 * A run that could not finish tries again itself, twice, a few seconds apart:
 * once it ends, nothing else has the draft, and another deletion may never come
 * at that company. The platform's own retries are not used, because the deploy
 * cannot ship a function that has them (`functionFailurePolicy.test.js`). What
 * the last try leaves is recorded for the next deletion at the company, as a
 * purge's leftovers are, once per deletion however often its event arrives. So
 * that the last try always gets to record, every step of a try (the check, each
 * file's delete, the record) that gets no answer within `STEP_MS` has failed:
 * the clients' own retries can outlast the run. A step given up on is not
 * stopped, though, and a delete that lands late can take a file a later try
 * found in use again; a driver who then submits that copy from their device is
 * asked to upload it again (`markSubmittedUploads`).
 */

const { onDocumentDeletedWithAuthContext } = require('firebase-functions/v2/firestore');
const { deleteDraftFiles, retryPendingFiles } = require('./draftFiles');

/** The waits before the second and the third try. */
const RETRY_WAITS_MS = Object.freeze([3000, 12000]);
/** The longest one step of a try may take. */
const STEP_MS = 30 * 1000;
/** No step starts this long after the run began, inside its `timeoutSeconds`. */
const RUN_MS = 290 * 1000;

/** Replaced by the tests, which have no seconds to spend. */
const timing = { wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }), stepMs: STEP_MS, runMs: RUN_MS };

/** The record of what one deletion left, named after its event: a repeated delivery is the same deletion. */
const recordIdOf = (event) => (event?.id ? `files_${String(event.id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)}` : undefined);

/** Was this the TTL policy deleting a draft that had expired? */
function expiredByTtl(event, data, now = Date.now()) {
    const expiresAt = data?.expiresAt?.toMillis?.();
    return event?.authType === 'system' && Number.isFinite(expiresAt) && expiresAt <= now;
}

exports.deleteExpiredDraftFiles = onDocumentDeletedWithAuthContext({
    document: 'companies/{companyId}/application_drafts/{applicantKey}',
    region: 'us-central1',
    // Three tries of at most three steps of `STEP_MS` each, and the waits between
    // them, take under four minutes; an event function gets one by default.
    timeoutSeconds: 300,
}, async (event) => {
    const runEnds = Date.now() + timing.runMs;
    const data = event.data?.data();
    if (!expiredByTtl(event, data)) return;
    const { companyId, applicantKey } = event.params;
    const removed = [{ key: applicantKey, data }];
    let files;
    for (let attempt = 0; ; attempt += 1) {
        const last = attempt === RETRY_WAITS_MS.length;
        // Never throws. Only the last try writes down what is left: an earlier
        // one tries again itself, and would write the same files down twice.
        files = await deleteDraftFiles(companyId, removed, { recordFailures: last, stepMs: timing.stepMs, recordId: recordIdOf(event) });
        if (files.failed === 0 || last) break;
        await timing.wait(RETRY_WAITS_MS[attempt]);
    }
    if (files.deleted + files.kept + files.failed > 0) {
        console.info(`[deleteExpiredDraftFiles] ${companyId}: ${files.deleted} file(s) deleted; ${files.kept} kept, ${files.failed} left`);
    }
    if (files.failed > 0) return;
    // What earlier deletions here could not finish, by a run that went through: a
    // run that failed would most likely fail them too, and spend their attempts.
    await retryPendingFiles(companyId, { stepMs: timing.stepMs, deadline: runEnds });
});

exports.__private = { RETRY_WAITS_MS, RUN_MS, STEP_MS, expiredByTtl, recordIdOf, timing };
