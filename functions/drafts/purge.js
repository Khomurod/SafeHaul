/**
 * Deleting an unfinished application with everything in it, for a Company Admin.
 *
 * The owner asked for this on 2026-10-07: deleting an unfinished application
 * deletes its answers, its uploaded photos and documents, every link sent for it,
 * and the same driver's other unfinished application at this company. Submitted
 * applications and hired drivers are never touched.
 *
 * `deleteApplicationDraft` (`admin.js`) stays as it was, removing the one
 * document, because the pages built before this (Production, until a release
 * promotes the new ones) still call it.
 *
 * ## Two calls: what would go, then the deletion
 *
 * `preview` answers what would be deleted: the application, how many files it
 * holds, and each of the driver's other unfinished applications with what it
 * shares with this one (`related.js`). The admin keeps any that is somebody
 * else's (a shared phone looks the same) and confirms the rest by key
 * (`alsoDelete`). A key that no longer shares anything with the application, or
 * is gone, is left alone and named in `skipped`.
 *
 * ## The order
 *
 * One transaction reads every draft, deletes them, and writes an audit entry and
 * a removal mark for each (`removalMarks.js`): the driver's own tab and the
 * carrier's link then say the application was removed instead of failing
 * quietly. The files go after it commits (`draftFiles.js`), each only when
 * nothing else still points at it.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db } = require('../firebaseAdmin');
const draft = require('../shared/applicationDraft');
const prepared = require('../shared/companyPreparedDraft');
const { guestUploadPathsIn } = require('../shared/guestUploads');
const { applicantKeyOf } = require('./identity');
const { RELATED_LIMIT, relatedDrafts, sharedFacts } = require('./related');
const { removalMark, removalMarkRef } = require('./removalMarks');
const { deleteDraftFiles, retryPendingFiles } = require('./draftFiles');
const { NOT_FOUND, auditCollection, authorize, staffAction } = require('./staff');

/** A preview is a read, opened as often as the admin presses Delete. */
const PREVIEW_LIMIT = Object.freeze({ limit: 120, windowSeconds: 300 });
/** The same budget as deleting one draft: rare, and a runaway loop should stop soon. */
const PURGE_LIMIT = Object.freeze({ limit: 30, windowSeconds: 300 });

const fileCountOf = (companyId, data) => guestUploadPathsIn(data?.formData, companyId).length;

/** The keys the admin confirmed, well formed, once each, never the application itself. */
function confirmedKeys(value, applicantKey) {
    const keys = (Array.isArray(value) ? value : []).map(applicantKeyOf).filter((key) => key && key !== applicantKey);
    return [...new Set(keys)].slice(0, RELATED_LIMIT);
}

async function preview(companyId, applicantKey) {
    const target = await draft.draftsCollection(companyId).doc(applicantKey).get();
    if (!target.exists) throw new HttpsError('not-found', NOT_FOUND);
    const related = await relatedDrafts(companyId, target);
    return {
        application: { ...prepared.toCompanySummary(target), fileCount: fileCountOf(companyId, target.data()) },
        related: related.map(({ doc, shares }) => ({
            ...prepared.toCompanySummary(doc),
            fileCount: fileCountOf(companyId, doc.data()),
            shares,
        })),
    };
}

/**
 * Deletes the application and the confirmed drafts, in one transaction with
 * their audit entries and removal marks. Answers what it deleted, as it was.
 */
async function deleteDrafts(companyId, uid, applicantKey, alsoDelete) {
    const drafts = draft.draftsCollection(companyId);
    const keys = [applicantKey, ...alsoDelete];
    return db.runTransaction(async (transaction) => {
        // Every read before any write, as a transaction requires.
        const docs = await Promise.all(keys.map((key) => transaction.get(drafts.doc(key))));
        const marks = await Promise.all(keys.map((key) => transaction.get(removalMarkRef(companyId, key))));
        const [target] = docs;
        if (!target.exists) return null;
        const targetData = target.data() || {};

        const deleted = [];
        const skipped = [];
        docs.forEach((doc, index) => {
            const key = keys[index];
            const data = doc.exists ? doc.data() || {} : null;
            // Re-asked here, of the drafts as they are now: one may have been
            // submitted, or changed its email, since the admin saw the preview.
            if (!data || (index > 0 && sharedFacts(targetData, data).length === 0)) {
                skipped.push(key);
                return;
            }
            transaction.delete(doc.ref);
            transaction.set(removalMarkRef(companyId, key), removalMark(marks[index].exists ? marks[index].data() : null, data));
            transaction.set(auditCollection(companyId).doc(), {
                ...staffAction('company_purged_draft', uid, key, data),
                ...(index > 0 ? { withApplicantKey: applicantKey } : {}),
            });
            deleted.push({ key, data });
        });
        return { deleted, skipped };
    });
}

/**
 * Deletes an unfinished application with everything in it; see the file header.
 *
 * `{ preview: true }` answers `{ application, related }` and changes nothing.
 * Otherwise `{ alsoDelete: [applicantKey] }` names the related drafts to delete
 * with it, and the answer is `{ deleted, skipped, files }`: the keys deleted, the
 * keys left alone, and how many files were deleted, kept for something else, or
 * left for the next deletion to finish.
 */
exports.purgeApplicationDraft = onCall({ cors: true }, async (request) => {
    const isPreview = request.data?.preview === true;
    const { uid, companyId, applicantKey } = await authorize(
        request,
        isPreview ? 'draft_admin_purge_preview' : 'draft_admin_purge',
        isPreview ? PREVIEW_LIMIT : PURGE_LIMIT,
    );
    if (isPreview) return preview(companyId, applicantKey);

    const outcome = await deleteDrafts(companyId, uid, applicantKey, confirmedKeys(request.data?.alsoDelete, applicantKey));
    if (!outcome) throw new HttpsError('not-found', NOT_FOUND);

    // What earlier deletions here could not finish first, so this one's own
    // failures wait for the next.
    await retryPendingFiles(companyId);
    const files = await deleteDraftFiles(companyId, outcome.deleted);
    const deleted = outcome.deleted.map(({ key }) => key);
    console.info(`[purgeApplicationDraft] ${companyId}: ${deleted.length} draft(s) and ${files.deleted} file(s) deleted by ${uid}; ${files.kept} kept, ${files.failed} left`);
    return { deleted, skipped: outcome.skipped, files };
});

exports.__private = { PREVIEW_LIMIT, PURGE_LIMIT, confirmedKeys };
