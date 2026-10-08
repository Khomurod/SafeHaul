/**
 * The files an unfinished application leaves when it is deleted, and which of
 * them may go.
 *
 * A driver's uploads sit in one flat folder per company
 * (`shared/guestUploads.js`), named by nothing that ties them to a draft, and
 * the same file can be pointed at from more than one place: the driver's other
 * unfinished application, an application they already submitted, the DQ file
 * the submission filed it into, the frozen snapshot of what they sent. So a file
 * the deleted draft points at is deleted only when none of those still points at
 * it; the submitted ones are read, never written, by `shared/submittedUploads.js`.
 * A path proves nothing about whose file it is, so on top of that a file goes only
 * while no submission has marked it, and only if it is newer than the marks
 * (`deletableUpload` in `shared/guestUploads.js`).
 * `shared/applicationStorage.js` is deliberately not used: its folder sweeps are
 * for a submitted application's own folder, and here would reach files the
 * driver's submitted application keeps.
 *
 * The drafts are deleted first and the files after, outside their transaction,
 * as Storage cannot join one. A file that could not be deleted is written down
 * (`draft_files_pending`, value-free but for the paths) and tried again by the
 * next deletion at the same company, with the check run again first. That check
 * knows the drafts by key alone, so it also reads every application changed
 * since the first one, and gives up rather than guess when there are too many.
 * When the first check itself fails, nothing is deleted or written down: a retry
 * could not ask what it asked.
 */

const { admin, db, storage } = require('../firebaseAdmin');
const draft = require('../shared/applicationDraft');
const { deletableUpload, guestUploadPathsIn } = require('../shared/guestUploads');
const { uploadPathsInApplicationsSince, uploadPathsInSubmittedApplications } = require('../shared/submittedUploads');
const { MIN_PHONE_DIGITS } = require('./related');

/** The rows the workspace lists, which is where a shared file would be. */
const RECENT_DRAFTS = 200;
const PER_QUERY = 10;
const PENDING_ACTION = 'draft_files_pending';
/** Pending records one deletion retries, so a backlog cannot slow the admin down. */
const RETRY_BATCH = 3;
const MAX_ATTEMPTS = 5;
/** Ahead of a check by this much, so an application stamped by another clock is not missed. */
const CLOCK_MARGIN_MS = 60 * 1000;

/** When a check began: what changes after it is the next check's to find. */
const checkTime = () => admin.firestore.Timestamp.fromMillis(Date.now() - CLOCK_MARGIN_MS);

function auditCollection(companyId) {
    return db.collection('companies').doc(companyId).collection('application_draft_audit');
}

/**
 * Every upload path something other than the deleted drafts points at.
 *
 * The unfinished applications that stay: the recent ones, and every one that
 * shares an identity, email or phone with a deleted draft. The applications the
 * same driver submitted: at the deleted draft's key, any filed under that key
 * after a collision (`applicantKey`), and any with the same email or phone.
 *
 * Asked once the drafts are deleted, so a draft found at a deleted key is a new
 * one, saved since, and what it points at counts like any other's.
 *
 * @param {Array<{key: string, data: object}>} removed the drafts deleted, as they were
 */
async function pathsStillUsed(companyId, removed) {
    const drafts = draft.draftsCollection(companyId);
    const queries = [drafts.orderBy('updatedAt', 'desc').limit(RECENT_DRAFTS)];
    for (const { data } of removed) {
        const email = String(data?.contactEmail || '').toLowerCase().trim();
        const phone = String(data?.contactPhone || '').replace(/\D/g, '');
        if (typeof data?.identityKey === 'string' && data.identityKey) {
            queries.push(drafts.where('identityKey', '==', data.identityKey).limit(PER_QUERY));
        }
        if (email) queries.push(drafts.where('contactEmail', '==', email).limit(PER_QUERY));
        if (phone.length >= MIN_PHONE_DIGITS) queries.push(drafts.where('contactPhone', '==', phone).limit(PER_QUERY));
    }
    const [snapshots, used] = await Promise.all([
        Promise.all(queries.map((query) => query.get())),
        uploadPathsInSubmittedApplications(companyId, removed),
    ]);
    for (const doc of snapshots.flatMap((snapshot) => snapshot.docs)) {
        guestUploadPathsIn(doc.data(), companyId).forEach((path) => used.add(path));
    }
    return used;
}

const KEPT = 'kept';

/**
 * Deletes each path a draft's deletion may take, and only while it is as it was
 * read: a submission marking it in between makes the delete fail (412) rather
 * than take a submitted application's file. A missing file counts as deleted.
 *
 * @returns {Promise<{kept: string[], failed: string[]}>}
 */
async function deletePaths(paths) {
    const bucket = storage.bucket();
    const results = await Promise.allSettled(paths.map(async (path) => {
        const file = bucket.file(path);
        const [metadata] = await file.getMetadata();
        if (!deletableUpload(metadata)) return KEPT;
        await file.delete({ ifMetagenerationMatch: metadata.metageneration, ignoreNotFound: true });
        return null;
    }));
    const kept = paths.filter((_, index) => results[index].value === KEPT || results[index].reason?.code === 412);
    const failed = paths.filter((_, index) => results[index].status === 'rejected' && ![404, 412].includes(results[index].reason?.code));
    return { kept, failed };
}

async function recordPending(companyId, keys, paths, checkedAt, attempts = 1) {
    try {
        await auditCollection(companyId).add({
            action: PENDING_ACTION,
            outcome: 'pending',
            applicantKeys: keys,
            paths,
            attempts,
            checkedAt,
            at: draft.serverTimestamp(),
            expiresAt: draft.expiresAt(),
        });
    } catch (error) {
        console.error(`[applicationDrafts] ${companyId}: could not record ${paths.length} file(s) left to delete: ${error?.message || 'unknown'}`);
    }
}

/**
 * Deletes the files of drafts that have just been deleted, except those still
 * pointed at elsewhere. Never throws: the drafts are already gone, and what could
 * not be done is recorded for the next deletion to finish.
 *
 * @param {string} companyId
 * @param {Array<{key: string, data: object}>} removed
 * @returns {Promise<{deleted: number, kept: number, failed: number}>}
 */
async function deleteDraftFiles(companyId, removed) {
    const candidates = [...new Set(removed.flatMap(({ data }) => guestUploadPathsIn(data?.formData, companyId)))];
    if (candidates.length === 0) return { deleted: 0, kept: 0, failed: 0 };
    const keys = removed.map(({ key }) => key);
    const checkedAt = checkTime();
    let used;
    try {
        used = await pathsStillUsed(companyId, removed);
    } catch (error) {
        // Not knowing what else uses a file is not a reason to delete it, and a
        // retry could not ask again: it knows the drafts by key alone. They stay.
        console.error(`[applicationDrafts] ${companyId}: could not check what else uses ${candidates.length} file(s), so they stay: ${error?.message || 'unknown'}`);
        return { deleted: 0, kept: 0, failed: candidates.length };
    }
    const unused = candidates.filter((path) => !used.has(path));
    const { kept, failed } = await deletePaths(unused);
    if (failed.length > 0) await recordPending(companyId, keys, failed, checkedAt);
    return {
        deleted: unused.length - kept.length - failed.length,
        kept: candidates.length - unused.length + kept.length,
        failed: failed.length,
    };
}

/**
 * Finishes what earlier deletions at this company could not, checking again
 * first what else uses each file. Best effort, a few records at a time.
 */
async function retryPendingFiles(companyId) {
    try {
        const pending = await auditCollection(companyId).where('action', '==', PENDING_ACTION).limit(RETRY_BATCH).get();
        for (const record of pending.docs) {
            const { applicantKeys = [], paths = [], attempts = 1, checkedAt } = record.data() || {};
            const retriedAt = checkTime();
            const [used, since] = await Promise.all([
                pathsStillUsed(companyId, applicantKeys.map((key) => ({ key, data: {} }))),
                uploadPathsInApplicationsSince(companyId, checkedAt),
            ]);
            await record.ref.delete();
            if (!since.complete) {
                console.error(`[applicationDrafts] ${companyId}: left ${paths.length} file(s) in place; too many applications changed since to check them.`);
                continue;
            }
            const { failed } = await deletePaths(paths.filter((path) => !used.has(path) && !since.paths.has(path)));
            if (failed.length === 0) continue;
            if (attempts >= MAX_ATTEMPTS) {
                console.error(`[applicationDrafts] ${companyId}: gave up deleting ${failed.length} file(s) after ${attempts} attempts.`);
                continue;
            }
            await recordPending(companyId, applicantKeys, failed, retriedAt, attempts + 1);
        }
    } catch (error) {
        console.error(`[applicationDrafts] ${companyId}: could not retry the files left to delete: ${error?.message || 'unknown'}`);
    }
}

module.exports = { PENDING_ACTION, deleteDraftFiles, pathsStillUsed, retryPendingFiles };
