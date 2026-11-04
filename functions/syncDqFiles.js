/**
 * syncDqFiles — called when the DQ tab opens: files any of the application's or
 * lead's uploads that no DQ record holds yet, kept or removed
 * (`shared/dqUploads.js`). It brings in an application's uploads that arrived
 * before its triggers filed uploads without a link, and a lead's, which no
 * trigger files.
 *
 * Any member of the company's team may call it, as anyone of the team may open
 * the tab; it files only the record's own answers.
 *
 * It also files the record's sealed documents that no DQ record holds
 * (`signed_<requestId>`): `sealDocument` files each one when it is sealed, so
 * this brings in one whose filing failed, or that was sealed before documents
 * were filed. Only a request linked to this record, signed, whose sealed PDF is
 * where the seal puts it; a removed entry stays removed.
 *
 * Answers `{ filed }`: how many records it wrote. A missing record files nothing.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db } = require('./firebaseAdmin');
const { assertCompanyAccessForRequest } = require('./shared/companyAccess');
const { fileDqUploads, uploadKeys } = require('./shared/dqUploads');
const { fileSealedDocumentInDq } = require('./sealedDocumentDq');

const LINK_FIELDS = Object.freeze({ applications: 'sourceApplicationId', leads: 'sourceLeadId' });

/** Files this record's signed documents that its DQ file lacks; never throws. */
async function fileMissingSealedDocuments(companyId, collectionName, recordId, filedIds) {
    try {
        const requests = await db.collection('companies').doc(companyId).collection('signing_requests')
            .where(LINK_FIELDS[collectionName], '==', recordId).get();
        let filed = 0;
        for (const doc of requests.docs) {
            const request = doc.data() || {};
            const storagePath = `secure_documents/${companyId}/completed/${doc.id}_signed.pdf`;
            if (request.status !== 'signed' || request.signedPdfUrl !== storagePath) continue;
            if (filedIds.has(`signed_${doc.id}`)) continue;
            const ok = await fileSealedDocumentInDq(companyId, doc.id, request, {
                storagePath,
                sha256Checksum: request.sha256Checksum || null,
            });
            if (ok) filed += 1;
        }
        return filed;
    } catch (err) {
        console.error('[syncDqFiles] Could not file the record\'s sealed documents:', err.message);
        return 0;
    }
}

const COLLECTIONS = Object.freeze(['applications', 'leads']);
const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/');

exports.syncDqFiles = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const { companyId, collectionName, applicationId } = request.data || {};
    if (!isId(companyId) || !isId(applicationId) || !COLLECTIONS.includes(collectionName)) {
        throw new HttpsError('invalid-argument', 'companyId, applicationId and collectionName (applications or leads) are required.');
    }
    await assertCompanyAccessForRequest(request, companyId, 'syncDqFiles');

    const recordRef = db.collection('companies').doc(companyId).collection(collectionName).doc(applicationId);
    const [record, filedRecords] = await Promise.all([recordRef.get(), recordRef.collection('dq_files').get()]);
    if (!record.exists) return { filed: 0 };

    const known = new Set(filedRecords.docs.flatMap((doc) => uploadKeys(doc.data(), companyId)));
    const filed = await fileDqUploads(recordRef, record.data(), {
        companyId,
        applicationId,
        isNew: (keys) => !keys.some((key) => known.has(key)),
        label: 'syncDqFiles',
    });
    const filedIds = new Set(filedRecords.docs.map((doc) => doc.id));
    const sealed = await fileMissingSealedDocuments(companyId, collectionName, applicationId, filedIds);
    return { filed: filed + sealed };
});
