/**
 * PEV — at day 30 with no answer, the record of attempts as a PDF, stored and
 * filed in the DQ file.
 *
 * Made once per request, when the daily job marks it "no response"
 * (./reminders.js), from the request's attempt log as it stands then. Stored
 * beside the request's own PDF (`…/pev_requests/PEV_ATTEMPTS_…`), so the team
 * opens it as it opens that one (`getSignedPevUrl`); linked from the row's
 * no-response history entry; filed once in the DQ file.
 *
 * Nothing here may stop the day-30 job: every failure is logged and the job
 * goes on to the carrier's email and the next request.
 */
const { storage } = require('../firebaseAdmin');
const { logger } = require('firebase-functions');
const { mirrorOntoEmployer, recordRefOf } = require('./employerMirror');
const { requestIdOf } = require('./requestLifecycle');
const { fileAttemptRecordInDq } = require('./requestAttachment');
const { attemptRecordFilename, buildAttemptRecordPdf } = require('./attemptRecordPdf');

/** Where one request's record of attempts lives. `requestId` is not the portal token. */
function attemptRecordPath({ companyId, collectionName, applicationId, employerName }, requestId) {
    const employer = String(employerName || 'Employer').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60);
    return `companies/${companyId}/${collectionName || 'applications'}/${applicationId}`
        + `/pev_requests/PEV_ATTEMPTS_${employer}_${String(requestId).slice(0, 8)}.pdf`;
}

/** The row's latest no-response entry gets the record's path, which View History opens. */
async function linkFromRow(recordRef, request, statusText, path) {
    try {
        await mirrorOntoEmployer(recordRef, request, (verification) => {
            const at = verification.history.map((entry) => entry?.action).lastIndexOf(statusText);
            if (at < 0 || verification.history[at].attemptRecordPath) return false;
            verification.history[at] = { ...verification.history[at], attemptRecordPath: path };
        });
    } catch (error) {
        logger.error('[PEV] The record of attempts could not be linked from the employer row.', error);
    }
}

/**
 * @param {object} requestRef the `verification_requests` document
 * @param {string} token      its id, used only to name a request older than `requestId`
 * @param {object} company    the company document
 * @param {string} statusText the row status the no-response mark wrote
 * @returns {Promise<{ path: string, filedInDq: boolean } | null>} null when nothing was made
 */
async function fileAttemptRecord(requestRef, token, company, statusText) {
    try {
        const request = (await requestRef.get()).data();
        if (!request) return null;
        const recordRef = recordRefOf(request);
        // A record deleted since the request went out has no DQ file to hold it.
        if (!(await recordRef.get()).exists) return null;

        const requestId = requestIdOf(request, token);
        const path = attemptRecordPath(request, requestId);
        const bytes = await buildAttemptRecordPdf({ request, company, requestId, generatedAt: Date.now() });
        await storage.bucket().file(path).save(Buffer.from(bytes), { metadata: { contentType: 'application/pdf' } });
        await requestRef.update({ attemptRecordPath: path });

        await linkFromRow(recordRef, request, statusText, path);
        const filedInDq = await fileAttemptRecordInDq(recordRef, {
            requestId, path, employerName: request.employerName, fileName: attemptRecordFilename(request.applicantName),
        });
        return { path, filedInDq };
    } catch (error) {
        logger.error('[PEV] The record of attempts could not be made; the no-response mark stands.', error);
        return null;
    }
}

module.exports = { attemptRecordPath, fileAttemptRecord };
