/**
 * A sealed document linked to a driver record, filed in that record's DQ file.
 *
 * A signing request names its record as `sourceApplicationId` (an application:
 * a post-application document, or a template the team sent to an applicant) or
 * `sourceLeadId` (a lead). Once `sealDocument` has marked it signed, it is filed
 * at `companies/{companyId}/{applications|leads}/{recordId}/dq_files/signed_<requestId>`,
 * as the server files a driver's uploads and a verification's PDFs
 * (`shared/dqUploads.js`, `employmentVerification/requestAttachment.js`):
 * `isSynced`, so removing it on the DQ tab hides the entry and leaves the
 * sealed PDF where the request keeps it; it opens from a link signed when
 * pressed (`getSignedDocumentUrl`). It holds the path of the one sealed PDF and
 * the checksum the seal recorded, never a copy.
 *
 * Created once: the id is named by the request, so a second filing, a repeated
 * delivery, or one the team removed, changes nothing. A record that is not this
 * company's (the path is scoped to it) or no longer exists files nothing.
 * Never throws: a filing that fails is logged and the seal stands.
 */
const { admin, db } = require('./firebaseAdmin');
const { clipText } = require('./shared/plainText');

const RECORD_LINKS = Object.freeze([['sourceApplicationId', 'applications'], ['sourceLeadId', 'leads']]);
const ALREADY_EXISTS = 6;

const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/');

/** The record a request is linked to, `{ collectionName, recordId }`, or null. */
function linkedRecordOf(request) {
    for (const [field, collectionName] of RECORD_LINKS) {
        if (isId(request?.[field])) return { collectionName, recordId: request[field] };
    }
    return null;
}

/**
 * @param {string} companyId
 * @param {string} requestId
 * @param {object} request the signing request as the seal read it
 * @param {{ storagePath: string, sha256Checksum: string }} sealed what the seal wrote
 * @returns {Promise<boolean>} whether the record's DQ file holds the document
 */
async function fileSealedDocumentInDq(companyId, requestId, request, { storagePath, sha256Checksum }) {
    const linked = linkedRecordOf(request);
    if (!linked) return false;
    const { collectionName, recordId } = linked;
    try {
        const recordRef = db.collection('companies').doc(companyId).collection(collectionName).doc(recordId);
        const record = await recordRef.get();
        if (!record.exists) {
            console.warn(`[Seal] ${requestId} is linked to ${collectionName}/${recordId}, which this company does not have; not filed.`);
            return false;
        }
        const owner = record.data() || {};
        const title = clipText(request.title, 100) || 'Signed document';
        const { FieldValue } = admin.firestore;
        await recordRef.collection('dq_files').doc(`signed_${requestId}`).create({
            type: 'signed_document',
            fileType: `Signed document – ${title}`,
            label: 'Signed document',
            fileName: `${title}.pdf`,
            storagePath,
            url: null,
            source: 'signed_document',
            isSynced: true,
            signingRequestId: requestId,
            sha256Checksum,
            uploadedBy: 'e_docs',
            uploadedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            // Who the record belongs to, as the driver's uploads carry it.
            applicationId: recordId,
            applicantId: owner.applicantId || null,
            driverId: owner.driverId || null,
            userId: owner.userId || null,
            ownerUserIds: [owner.driverId || owner.userId || owner.applicantId || recordId],
        });
        return true;
    } catch (err) {
        if (err?.code === ALREADY_EXISTS || /already exists/i.test(err?.message || '')) return true;
        console.error(`[Seal] Could not file ${requestId} in the DQ file of ${collectionName}/${recordId}:`, err.message);
        return false;
    }
}

module.exports = { fileSealedDocumentInDq, linkedRecordOf };
