/**
 * PEV — a result the company received another way (fax, mail, phone) and
 * uploaded with "Upload Result".
 *
 * The client uploads the file (`pev_results/` is add-only for the team in
 * `storage.rules`) and this callable records it, because the company cannot
 * write `verification_requests`: the row reads Completed with the file's path,
 * the employer's request is completed too, so its reminders stop and its day-30
 * mark can no longer overwrite the result, and the file is filed in the DQ file.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db, storage } = require("../firebaseAdmin");
const { logger } = require("firebase-functions");
const { assertCompanyAccessForRequest } = require("../shared/companyAccess");
const { employerNameOf } = require("../shared/employerIdentity");
const { mirrorOntoEmployer } = require("./employerMirror");
const { fileResultInDq } = require("./requestAttachment");
const { LIVE_STATUSES, closeRequests, requestsForEmployer } = require("./requestLifecycle");

const ALLOWED_COLLECTIONS = ['applications', 'leads'];

/** The file's name inside this record's `pev_results/` folder, or null when the path is anywhere else. */
function resultFileName(storagePath, { companyId, collectionName, applicationId }) {
    const folder = `companies/${companyId}/${collectionName}/${applicationId}/pev_results/`;
    if (typeof storagePath !== 'string' || !storagePath.startsWith(folder)) return null;
    const name = storagePath.slice(folder.length);
    return name && !name.includes('/') && !name.includes('..') ? name : null;
}

exports.recordManualVerificationResult = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const {
        companyId, applicationId, collectionName = 'applications',
        employerId, employerIndex, employerName, storagePath, fileName,
    } = request.data || {};
    if (!companyId || !applicationId || !storagePath) {
        throw new HttpsError('invalid-argument', 'Missing required fields.');
    }
    if (!ALLOWED_COLLECTIONS.includes(collectionName)) {
        throw new HttpsError('invalid-argument', `Invalid collection: ${collectionName}`);
    }
    const index = Number(employerIndex);
    if (!Number.isInteger(index) || index < 0) {
        throw new HttpsError('invalid-argument', 'employerIndex must be a non-negative integer.');
    }
    const record = { companyId, collectionName, applicationId };
    const storedName = resultFileName(storagePath, record);
    if (!storedName) {
        throw new HttpsError('invalid-argument', "The result must be uploaded to this record's verification results.");
    }

    await assertCompanyAccessForRequest(request, companyId, 'PEV/recordManualVerificationResult');

    const [exists] = await storage.bucket().file(storagePath).exists();
    if (!exists) throw new HttpsError('not-found', 'The uploaded result was not found. Upload it again.');

    const shownName = String(fileName || storedName).slice(0, 200);
    const now = admin.firestore.Timestamp.now();
    const at = new Date(now.toMillis()).toISOString();
    const recordRef = db.collection('companies').doc(companyId).collection(collectionName).doc(applicationId);

    // The name the press was on: a row without an id is trusted at its index
    // only while it is still that employer (`resolveEmployerTarget`).
    const mirrored = await mirrorOntoEmployer(recordRef, { employerId, employerIndex: index, employerName }, (verification) => {
        verification.status = 'Completed';
        verification.completedAt = verification.completedAt || at;
        verification.resultUrl = storagePath;
        // A retry of the same upload records it once.
        if (!verification.history.some((entry) => entry?.url === storagePath)) {
            verification.history.push({ action: 'Result Uploaded', fileName: shownName, url: storagePath, timestamp: at });
        }
    });
    if (!mirrored) {
        throw new HttpsError('not-found', 'That employer is no longer on this application. Refresh and try again.');
    }

    // The row already shows the result, and day 30 never overwrites a
    // Completed row (./reminders.js), so a failure here costs reminders only.
    // A late result completes a request already marked "no response"; the
    // mark stays in the row's history.
    let closedRequests = 0;
    try {
        const requests = await requestsForEmployer(record, mirrored.employers, mirrored.index);
        closedRequests = await closeRequests(requests, [...LIVE_STATUSES, 'no_response'], {
            status: 'completed',
            completedAt: now,
            completedBy: 'manual_result',
            manualResultPath: storagePath,
            manualResultBy: request.auth.uid,
        });
    } catch (error) {
        logger.error('[PEV] The uploaded result was recorded, but its request could not be closed.', error);
    }

    // In the DQ file as the portal's answer is: one record per file.
    const filedInDq = await fileResultInDq(recordRef, {
        path: storagePath,
        employerName: employerNameOf(mirrored.employers[mirrored.index]),
        fileName: shownName,
        uploadedBy: request.auth.uid,
    });

    return { success: true, verification: mirrored.verification, closedRequests, filedInDq };
});
