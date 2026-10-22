/**
 * PEV — the request PDF as a stored file and as an email attachment.
 *
 * Built once, when the request is sent, and kept at
 * `companies/{companyId}/{collection}/{recordId}/pev_requests/...`: the team can
 * read it there (`storage.rules`), only the server writes it. Reminders attach
 * the same bytes, so every email about one request carries one document.
 *
 * Nothing here may stop a request from going out. A document that cannot be
 * built or stored is logged and the request is sent without it; the caller is
 * told, so the screen can say so.
 */

const { admin, storage } = require('../firebaseAdmin');
const { logger } = require('firebase-functions');
const { buildRequestPdf, requestPdfFilename } = require('./requestPdf');

/** Where one request's document lives. `requestId` is not the portal token. */
function requestPdfPath({ companyId, collectionName, applicationId, employerName, requestId }) {
    const employer = String(employerName || 'Employer').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60);
    return `companies/${companyId}/${collectionName}/${applicationId}/pev_requests/PEV_REQUEST_${employer}_${requestId.slice(0, 8)}.pdf`;
}

function asAttachment(bytes, applicantName) {
    return {
        filename: requestPdfFilename(applicantName),
        content: Buffer.from(bytes),
        contentType: 'application/pdf',
    };
}

/**
 * Build and store the document for a request.
 *
 * @returns {Promise<{ path: string, release: string, attachment: object } | null>}
 */
async function storeRequestPdf({ path, ...content }) {
    try {
        const { bytes, release } = await buildRequestPdf(content);
        await storage.bucket().file(path).save(Buffer.from(bytes), {
            metadata: { contentType: 'application/pdf' },
        });
        return { path, release, attachment: asAttachment(bytes, content.applicantName) };
    } catch (error) {
        logger.error('[PEV] The request document could not be built or stored; sending without it.', error);
        return null;
    }
}

/** The stored document as attachments for a reminder: one, or none when it is gone. */
async function reminderAttachments(path, applicantName) {
    if (!path) return [];
    try {
        const [bytes] = await storage.bucket().file(path).download();
        return [asAttachment(bytes, applicantName)];
    } catch (error) {
        logger.warn('[PEV] The request document could not be read for a reminder; sending without it.', error);
        return [];
    }
}

/**
 * File the stored document in the driver's DQ file, as the server files the
 * application's own uploads: `isSynced`, so removing it on the DQ tab hides the
 * entry and keeps the request's copy. It opens from a link signed when pressed.
 */
async function fileRequestInDq(recordRef, { requestId, path, employerName, applicantName }) {
    const { FieldValue } = admin.firestore;
    try {
        await recordRef.collection('dq_files').doc(`pev_request_${requestId}`).set({
            type: 'pev_request',
            fileType: `PEV Request – ${employerName}`,
            label: 'PEV Request',
            fileName: requestPdfFilename(applicantName),
            storagePath: path,
            url: null,
            source: 'pev_request',
            isSynced: true,
            uploadedBy: 'pev_request',
            uploadedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        });
        return true;
    } catch (error) {
        logger.error('[PEV] The request document could not be filed in the DQ file.', error);
        return false;
    }
}

module.exports = { fileRequestInDq, requestPdfPath, storeRequestPdf, reminderAttachments };
