// functions/shared/preserveApplicationPdf.js
//
// Generates the application PDF ONCE and preserves it.
//
// WHY "ONCE" IS THE WHOLE POINT
// -----------------------------
// The old flow regenerated the PDF in the browser on every download, from live
// application data and a hardcoded copy of the legal text. So "the original"
// was not a document at all — it was a function of whatever the database
// happened to say that afternoon. Edit a question, rename the company, correct a
// typo in an agreement, and every past applicant's "original" silently changed.
//
// Here the document is rendered from the frozen submission snapshot, written to
// Cloud Storage, and never rewritten. A later request for the original returns
// the stored bytes. A genuine resubmission takes the next snapshot sequence and
// therefore its own file, sitting beside the first rather than on top of it.
//
// WHERE IT IS STORED, AND WHY THERE
// ---------------------------------
// `application_originals/{companyId}/{applicationId}/{snapshotId}.pdf`.
//
// That prefix has NO Storage security rule, so Firestore's default-deny applies
// and no client — company staff included — can read it directly with their own
// token. Every read goes through the callable, which authorizes the caller and
// writes an audit record. That matters because this document may carry the
// applicant's full Social Security Number: an access path that cannot be audited
// is not an acceptable one for it.
//
// The document's existence is surfaced through the DQ file, which is SafeHaul's
// existing Documents model, rather than through a parallel system of its own.

const { renderApplicationPdf } = require('./pdf/applicationDocument');

/** Storage prefix. Deliberately outside every `storage.rules` match. */
const ORIGINAL_PDF_PREFIX = 'application_originals';

/** The DQ file type this document files itself under. */
const DQ_FILE_TYPE = 'Application for Employment';

/** Build the immutable storage path for one preserved submission. */
function originalPdfPath({ companyId, applicationId, snapshotId }) {
    return `${ORIGINAL_PDF_PREFIX}/${companyId}/${applicationId}/${snapshotId}.pdf`;
}

/**
 * A human filename for the download.
 *
 * Names the applicant and the submission date, never an id, a UUID or anything
 * derived from the SSN — filenames end up in browser history, download folders,
 * chat messages and screen shares.
 */
function originalPdfFilename({ applicantName, submittedAt, sequence }) {
    const safeName = String(applicantName || 'Applicant')
        .replace(/[^A-Za-z0-9 ]+/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60) || 'Applicant';
    const day = String(submittedAt || '').slice(0, 10) || 'undated';
    const suffix = Number(sequence) > 1 ? `-resubmission-${sequence}` : '';
    return `Driver-Application-${safeName}-${day}${suffix}.pdf`;
}

/** The deterministic DQ file document id for one preserved submission. */
function dqFileIdFor(snapshotId) {
    return `application-pdf-${snapshotId}`;
}

/** GCS refuses a create-only write on an existing object with 412. */
function isPreconditionFailure(error) {
    return error?.code === 412 || /precondition/i.test(String(error?.message || ''));
}

/**
 * File the document in the Documents model SafeHaul already has.
 *
 * Written on BOTH paths — after a fresh save and when the object already
 * existed. If `save()` succeeded but this write did not (a crash between the
 * two, a transient Firestore failure), the next run must repair it; an early
 * return on the existing-object path left the preserved original absent from
 * the DQ tab forever, while the caller was told it had been preserved.
 *
 * Idempotent: a deterministic document id and a merge, so repeating it is a
 * no-op rather than a duplicate row.
 */
async function writeDqFileEntry({
    db, companyId, applicationId, snapshotId, sequence, storagePath, fileName, ownerIds, serverTimestamp,
}) {
    await db
        .collection('companies').doc(companyId)
        .collection('applications').doc(applicationId)
        .collection('dq_files').doc(dqFileIdFor(snapshotId))
        .set({
            // `fileType` / `fileName` are the field names the DQ tab reads.
            // Writing the document in the shape the existing Documents model
            // already uses is the point: this is not a parallel store.
            fileType: DQ_FILE_TYPE,
            fileName,
            storagePath,
            // No durable link, deliberately: the file is served only by the
            // audited callable, so a `url` here would be an unaudited way in.
            url: null,
            source: 'preserved_submission',
            snapshotId,
            sequence,
            isOriginal: Number(sequence) === 1,
            requiresAuditedAccess: true,
            containsFullSsn: true,
            companyId,
            applicationId,
            applicantId: ownerIds.applicantId || applicationId,
            driverId: ownerIds.driverId || applicationId,
            ownerUserIds: [ownerIds.driverId || ownerIds.applicantId || applicationId],
            createdAt: serverTimestamp,
        }, { merge: true });
}

/**
 * Render, store and file the preserved application PDF.
 *
 * Idempotent: if the object already exists it is left exactly as it is and the
 * existing path is returned. Re-running this can therefore never rewrite an
 * original, which is the property the whole design rests on.
 *
 * @param {object} opts
 * @param {object} opts.db
 * @param {object} opts.storage        `admin.storage()`.
 * @param {*} opts.serverTimestamp
 * @param {string} opts.companyId
 * @param {string} opts.applicationId
 * @param {object} opts.snapshot       The frozen submission snapshot.
 * @param {string} opts.snapshotId     e.g. `v1`.
 * @param {number} opts.sequence       1 is the original.
 * @param {string} [opts.signatureImage] `data:image/png;base64,...`
 * @param {object} [opts.ownerIds]     `{ applicantId, driverId }` for the DQ read rule.
 * @param {string} [opts.logLabel]
 * @returns {Promise<{storagePath, fileName, pageCount, applicantName, alreadyExisted}>}
 */
async function preserveApplicationPdf({
    db,
    storage,
    serverTimestamp,
    companyId,
    applicationId,
    snapshot,
    snapshotId,
    sequence = 1,
    signatureImage = null,
    ownerIds = {},
    logLabel = 'preserveApplicationPdf',
}) {
    if (!db || !storage) throw new Error('preserveApplicationPdf requires db and storage');
    if (!companyId || !applicationId || !snapshotId) {
        throw new Error('preserveApplicationPdf requires companyId, applicationId and snapshotId');
    }

    const storagePath = originalPdfPath({ companyId, applicationId, snapshotId });
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);

    /** Adopt an object that is already there, repairing its DQ entry. */
    const adoptExisting = async () => {
        const [metadata] = await file.getMetadata();
        const fileName = metadata?.metadata?.safehaulFileName || originalPdfFilename({
            applicantName: metadata?.metadata?.safehaulApplicant,
            submittedAt: snapshot?.submittedAt,
            sequence,
        });
        await writeDqFileEntry({
            db, companyId, applicationId, snapshotId, sequence, storagePath, fileName,
            ownerIds, serverTimestamp,
        });
        console.log(`[${logLabel}] Original PDF already preserved at ${storagePath}; left untouched`);
        return {
            storagePath,
            fileName,
            pageCount: Number(metadata?.metadata?.safehaulPageCount) || null,
            applicantName: metadata?.metadata?.safehaulApplicant || null,
            alreadyExisted: true,
        };
    };

    const [exists] = await file.exists();
    if (exists) return adoptExisting();

    // The stored original is the AUTHORIZED original: it carries the full SSN.
    // Every path that serves it authorizes the caller and audits the access.
    const { bytes, pageCount, applicantName } = await renderApplicationPdf({
        snapshot,
        includeFullSsn: true,
        signatureImage,
        sequence,
        generatedAt: new Date().toISOString(),
    });

    const fileName = originalPdfFilename({
        applicantName,
        submittedAt: snapshot?.submittedAt,
        sequence,
    });

    try {
        await file.save(Buffer.from(bytes), {
            resumable: false,
            contentType: 'application/pdf',
            // Create-only. `exists()` then `save()` is not atomic: two redeliveries
            // can both see no object and both write, and Cloud Storage lets the
            // later one replace the earlier. Since each render stamps its own
            // `generatedAt`, that would silently swap the immutable original for
            // different bytes. `ifGenerationMatch: 0` makes the second writer fail.
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: {
                contentType: 'application/pdf',
                // Custom metadata carries nothing sensitive: a name, a page count and
                // the tenant binding. Never the SSN, and never a signed URL.
                metadata: {
                    safehaulCompanyId: companyId,
                    safehaulApplicationId: applicationId,
                    safehaulSnapshotId: snapshotId,
                    safehaulSequence: String(sequence),
                    safehaulApplicant: applicantName,
                    safehaulPageCount: String(pageCount),
                    safehaulFileName: fileName,
                    safehaulContainsFullSsn: 'true',
                },
            },
        });
    } catch (error) {
        // The other writer won the race. Its object IS the original; ours is
        // discarded. That is the correct outcome, not a failure.
        if (!isPreconditionFailure(error)) throw error;
        return adoptExisting();
    }

    await writeDqFileEntry({
        db, companyId, applicationId, snapshotId, sequence, storagePath, fileName,
        ownerIds, serverTimestamp,
    });

    console.log(
        `[${logLabel}] Preserved original application PDF (${pageCount} pages) at ${storagePath}`,
    );

    return { storagePath, fileName, pageCount, applicantName, alreadyExisted: false };
}

module.exports = {
    DQ_FILE_TYPE,
    ORIGINAL_PDF_PREFIX,
    dqFileIdFor,
    originalPdfFilename,
    originalPdfPath,
    preserveApplicationPdf,
};
