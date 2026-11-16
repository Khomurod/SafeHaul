/**
 * The driver's uploads an application or lead files in its DQ file: one
 * `dq_files/{type}` record per document type, written by the server alone —
 * when an application arrives, when one of its uploads changes
 * (`driverSync.js`), and when the DQ tab opens (`syncDqFiles.js`).
 *
 * An upload is `{ name, storagePath }`; one stored before 2026-09-08 may hold
 * only a `url`. An upload and a record are the same file when they share its
 * path, if it is one of this company's uploads, or its link (`uploadKeys`): a
 * link signed again for the same file is not a new upload, and a record that
 * kept only the link still matches.
 *
 * Removing a filed entry on the DQ tab keeps its record with `removedAt`, so the
 * upload stays removed: it is matched and not filed again. Filing a different
 * upload of that type clears the mark.
 *
 * A record's valid-until date (`expirationDate`) is the application's own answer
 * for its type, copied when it is filed and again when that answer changes
 * (`syncDqExpirations`). The DQ tab may set it too; the next change of the answer
 * replaces it. The application's answer is never written from the DQ file: it is
 * the driver's, and a company's change to it needs the driver's approval.
 */

const { admin } = require('../firebaseAdmin');
const { isGuestUploadPath } = require('./guestUploads');

/** The answers that are DQ documents, each with its record's id and label. */
const DQ_UPLOADS = Object.freeze([
    { field: 'cdl-front', type: 'license_front', label: 'CDL Front', expirationField: 'cdlExpiration' },
    { field: 'cdl-back', type: 'license_back', label: 'CDL Back', expirationField: 'cdlExpiration' },
    { field: 'medical-card-upload', type: 'medical_card', label: 'Medical Card', expirationField: 'medCardExpiration' },
    { field: 'twic-card-upload', type: 'twic_card', label: 'TWIC Card', expirationField: 'twicExpiration' },
    { field: 'mvr-upload', type: 'mvr', label: 'MVR' },
    { field: 'mvr-consent-upload', type: 'mvr_consent', label: 'MVR Consent' },
    { field: 'drug-test-consent-upload', type: 'drug_test_consent', label: 'Drug Test Consent' },
    { field: 'ssc-upload', type: 'ssn_card', label: 'SSN Card' },
    // Attached by a recruiter preparing the application; an FCRA consumer report (owner decision В2).
    { field: 'psp-report-upload', type: 'psp_report', label: 'PSP Report' },
]);

/** What names an upload, or a record of one: its path and its link, as it has them. */
function uploadKeys(value, companyId) {
    if (!value || typeof value !== 'object') return [];
    const keys = [];
    if (isGuestUploadPath(value.storagePath, companyId)) keys.push(`path:${value.storagePath}`);
    if (typeof value.url === 'string' && value.url) keys.push(`url:${value.url}`);
    return keys;
}

/** The record that files `upload`, the answer `mapping.field` of `record`. */
function dqRecordFor(mapping, upload, record, applicationId) {
    const { FieldValue } = admin.firestore;
    const url = typeof upload.url === 'string' && upload.url ? upload.url : null;
    const expirationDate = mapping.expirationField ? record[mapping.expirationField] : null;
    return {
        type: mapping.type,
        fileType: mapping.label,
        label: mapping.label,
        status: 'pending_review',
        // Records are merged into: a link or a date the last upload had must not stay with this one.
        fileUrl: url || FieldValue.delete(),
        url: url || FieldValue.delete(),
        storagePath: upload.storagePath || upload.ref || '',
        fileName: upload.name || `${mapping.label}.jpg`,
        expirationDate: expirationDate || FieldValue.delete(),
        uploadedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        uploadedBy: 'driver_app',
        applicationId,
        applicantId: record.applicantId || null,
        driverId: record.driverId || null,
        userId: record.userId || null,
        ownerUserIds: [record.driverId || record.userId || record.applicantId || applicationId],
        isSynced: true,
        sourceField: mapping.field,
        removedAt: FieldValue.delete(),
    };
}

/**
 * Files each DQ upload of `record` that `isNew(keys, mapping)` accepts, one write
 * at a time; one that fails is logged and the rest are still filed.
 *
 * @returns {Promise<number>} how many were filed
 */
async function fileDqUploads(recordRef, record, { companyId, applicationId, isNew, label }) {
    let filed = 0;
    for (const mapping of DQ_UPLOADS) {
        const upload = record[mapping.field];
        const keys = uploadKeys(upload, companyId);
        if (keys.length === 0 || !isNew(keys, mapping)) continue;
        try {
            await recordRef.collection('dq_files').doc(mapping.type)
                .set(dqRecordFor(mapping, upload, record, applicationId), { merge: true });
            filed += 1;
        } catch (error) {
            console.error(`[${label}] Could not file ${mapping.type} for ${applicationId}:`, error);
        }
    }
    return filed;
}

const sameAnswer = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * When the application's `cdlExpiration`, `medCardExpiration` or
 * `twicExpiration` changed from `before` to `after`, the synced records of that
 * type take the new date, as a new upload of it would (`dqRecordFor`), and lose
 * theirs when the answer is cleared. Only records the server filed and the team
 * has not removed: a team upload keeps its own date. One that fails is logged
 * and the rest still change.
 *
 * @returns {Promise<number>} how many records changed
 */
async function syncDqExpirations(recordRef, before, after, { applicationId, label }) {
    const { FieldValue } = admin.firestore;
    let changed = 0;
    for (const mapping of DQ_UPLOADS) {
        const field = mapping.expirationField;
        if (!field || sameAnswer(before?.[field], after?.[field])) continue;
        try {
            const ref = recordRef.collection('dq_files').doc(mapping.type);
            const snap = await ref.get();
            const filed = snap.exists ? snap.data() || {} : null;
            if (!filed?.isSynced || filed.removedAt) continue;
            const date = after?.[field] || null;
            if (sameAnswer(filed.expirationDate, date)) continue;
            await ref.update({ expirationDate: date || FieldValue.delete() });
            changed += 1;
        } catch (error) {
            console.error(`[${label}] Could not update the date of ${mapping.type} for ${applicationId}:`, error);
        }
    }
    return changed;
}

module.exports = { fileDqUploads, syncDqExpirations, uploadKeys };
