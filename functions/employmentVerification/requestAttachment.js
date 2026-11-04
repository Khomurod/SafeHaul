/**
 * PEV — the request PDF as a stored file and as an email attachment, and both
 * the request and its result filed in the driver's DQ file.
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

const crypto = require('crypto');
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

/** Firestore's ALREADY_EXISTS, as `create()` reports it. */
const isAlreadyExists = (error) => error?.code === 6 || /already exists/i.test(error?.message || '');

/** One DQ record per result file: its id is named by the file's path, so filing it again finds it. */
function resultDqId(path) {
    return `pev_result_${crypto.createHash('sha256').update(path).digest('hex').slice(0, 24)}`;
}

/** The portal answer's name in the DQ file, beside the request's. */
function resultPdfFilename(applicantName) {
    return requestPdfFilename(applicantName).replace('-Request-', '-Response-');
}

/**
 * File a verification result — the portal answer's PDF, or a file the company
 * uploaded with "Upload Result" — in the driver's DQ file, as the request's is
 * filed (`isSynced`, opens from a link signed when pressed). Created once: a
 * second filing of the same file, or of one the team removed on the DQ tab,
 * changes nothing.
 *
 * @returns {Promise<boolean>} whether the DQ file holds it
 */
async function fileResultInDq(recordRef, { path, employerName, fileName, uploadedBy = 'pev_result' }) {
    const { FieldValue } = admin.firestore;
    try {
        await recordRef.collection('dq_files').doc(resultDqId(path)).create({
            type: 'pev_result',
            fileType: `PEV Result – ${employerName || 'Employer'}`,
            label: 'PEV Result',
            fileName,
            storagePath: path,
            url: null,
            source: 'pev_result',
            isSynced: true,
            uploadedBy,
            uploadedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        });
        return true;
    } catch (error) {
        if (isAlreadyExists(error)) return true;
        logger.error('[PEV] The verification result could not be filed in the DQ file.', error);
        return false;
    }
}

module.exports = {
    fileRequestInDq, fileResultInDq, requestPdfPath, resultPdfFilename, storeRequestPdf, reminderAttachments,
};
