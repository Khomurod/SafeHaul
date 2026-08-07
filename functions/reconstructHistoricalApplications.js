/**
 * reconstructHistoricalApplications.js
 * ====================================
 * Gives applications submitted before preservation a preserved record — and a
 * preserved PDF — built only from what survives.
 *
 * WHY A JOB AND NOT A READ-TIME FALLBACK
 * --------------------------------------
 * A read-time fallback would rebuild the record on every view, from data that
 * changes between views. That is the defect the whole programme exists to fix,
 * moved somewhere less visible. Reconstruction happens once, is written to the
 * same immutable subcollection as a live submission, and is marked as
 * reconstructed so no consumer can mistake it for one.
 *
 * SAFETY
 * ------
 *   * Idempotent. `writeSubmissionSnapshot` claims a sequence with `create()`,
 *     so an application that already has a record is skipped rather than
 *     overwritten — and a live submission's record can never be replaced by a
 *     reconstruction.
 *   * Repeatable. It resumes from a cursor and can be run any number of times.
 *   * Reversible in the only sense that matters: it adds records, never edits or
 *     deletes one.
 *   * `dryRun` reports exactly what it would do without writing anything, so the
 *     first run can be inspected before it is a fact.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { admin, db, storage } = require('./firebaseAdmin');
const { reconstructSubmissionSnapshot } = require('./shared/reconstructSubmission');
const { writeSubmissionSnapshot } = require('./shared/writeSubmissionSnapshot');
const { preserveApplicationPdf, originalPdfPath } = require('./shared/preserveApplicationPdf');
const { RECORD_STATUS, stampSubmissionRecordStatus } = require('./shared/submissionRecordStatus');

/** Applications examined per company page. */
const PAGE_SIZE = 50;

/** Ceiling for one invocation, so a call cannot run past its timeout. */
const DEFAULT_MAX_APPLICATIONS = 200;

/**
 * Reconstruct the applications of one company.
 *
 * @returns {Promise<{scanned, reconstructed, skipped, failed, pdfs, truncated,
 *   lastApplicationId, unrecoverable, errors}>}
 */
/**
 * Preserve the PDF for an application whose record exists but whose document
 * does not. Returns true when it wrote one.
 *
 * Safe to call on every skipped application: `preserveApplicationPdf` writes
 * create-only, so an existing object is left exactly as it is.
 */
async function repairMissingPdf({ doc, companyId, snapshot }) {
    if (!snapshot) return false;

    const file = storage.bucket().file(originalPdfPath({
        companyId, applicationId: doc.id, snapshotId: 'v1',
    }));
    const [exists] = await file.exists();
    if (exists) return false;

    try {
        await preserveApplicationPdf({
            db,
            storage,
            serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            companyId,
            applicationId: doc.id,
            snapshot,
            snapshotId: 'v1',
            sequence: 1,
            signatureImage: doc.data()?.signature || null,
            ownerIds: {
                applicantId: doc.data()?.applicantId || doc.id,
                driverId: doc.data()?.driverId || doc.id,
            },
            logLabel: 'reconstructHistoricalApplications:repair',
        });
        logger.info(
            `[reconstructHistoricalApplications] Repaired the missing preserved PDF for ${doc.id}`,
        );
        return true;
    } catch (error) {
        // A repair failure must not abort the company: the record itself is
        // intact, and the next run will try again.
        logger.warn(
            `[reconstructHistoricalApplications] Could not repair the PDF for ${doc.id}: `
            + `${error?.message || error}`,
        );
        return false;
    }
}

async function reconstructForCompany({
    companyId,
    company,
    maxApplications,
    startAfterId = null,
    dryRun = false,
}) {
    const applications = db
        .collection('companies').doc(companyId)
        .collection('applications')
        .orderBy('__name__');

    const result = {
        scanned: 0,
        reconstructed: 0,
        skipped: 0,
        failed: 0,
        pdfs: 0,
        truncated: false,
        lastApplicationId: null,
        unrecoverable: {},
        errors: [],
    };

    let cursor = startAfterId;

    for (;;) {
        if (result.scanned >= maxApplications) {
            result.truncated = true;
            break;
        }

        const remaining = Math.min(PAGE_SIZE, maxApplications - result.scanned);
        const page = await (cursor ? applications.startAfter(cursor) : applications).limit(remaining).get();
        if (page.empty) break;

        for (const doc of page.docs) {
            result.scanned += 1;
            cursor = doc.id;
            result.lastApplicationId = doc.id;

            try {
                // Sequence 1 is THE original. If anything already holds it —
                // a live submission or an earlier reconstruction — this
                // application is done, and nothing here may touch it.
                const existing = await doc.ref.collection('submission').doc('v1').get();
                if (existing.exists) {
                    result.skipped += 1;

                    // The record is preserved, but its PDF may not be. A
                    // submission whose snapshot committed and whose PDF write
                    // then failed returns `pdfPreserved: false` and nothing else
                    // ever retries it — so without this, its official document
                    // would be missing permanently while every later run
                    // skipped it as "already done".
                    //
                    // Repairing from the STORED snapshot, never a fresh rebuild,
                    // keeps the document faithful to the preserved record.
                    if (!dryRun) {
                        const repaired = await repairMissingPdf({
                            doc, companyId, snapshot: existing.data(),
                        });
                        if (repaired) result.pdfs += 1;
                    }
                    continue;
                }

                const { snapshot, unrecoverable } = reconstructSubmissionSnapshot({
                    application: { id: doc.id, ...doc.data() },
                    company,
                });

                for (const reason of unrecoverable) {
                    result.unrecoverable[reason] = (result.unrecoverable[reason] || 0) + 1;
                }

                if (dryRun) {
                    result.reconstructed += 1;
                    continue;
                }

                const written = await writeSubmissionSnapshot({
                    db,
                    companyId,
                    applicationId: doc.id,
                    snapshot,
                    ownerIds: {
                        applicantId: doc.data().applicantId || doc.id,
                        driverId: doc.data().driverId || doc.id,
                    },
                    logLabel: 'reconstructHistoricalApplications',
                });

                // A reconstruction that did not land on sequence 1 means someone
                // wrote the original between the check and the claim. Leave it:
                // a reconstruction sitting beside a real submission would be a
                // second "original".
                if (written.sequence !== 1) {
                    result.skipped += 1;
                    continue;
                }

                result.reconstructed += 1;

                try {
                    await preserveApplicationPdf({
                        db,
                        storage,
                        serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                        companyId,
                        applicationId: doc.id,
                        snapshot,
                        snapshotId: written.snapshotId,
                        sequence: written.sequence,
                        signatureImage: doc.data().signature || null,
                        ownerIds: {
                            applicantId: doc.data().applicantId || doc.id,
                            driverId: doc.data().driverId || doc.id,
                        },
                        logLabel: 'reconstructHistoricalApplications',
                    });
                    result.pdfs += 1;
                } catch (pdfError) {
                    // The record is the valuable half and it is already written.
                    // A missing PDF is recoverable by a later run; losing the
                    // record would not be.
                    logger.warn(
                        `[reconstructHistoricalApplications] Record written but PDF failed for `
                        + `${doc.id} (company ${companyId}): ${pdfError.message}`,
                    );
                }

                await stampSubmissionRecordStatus({
                    db,
                    companyId,
                    applicationId: doc.id,
                    submissionRecord: {
                        status: RECORD_STATUS.RECORDED,
                        snapshotId: written.snapshotId,
                        sequence: written.sequence,
                        isOriginal: true,
                        source: 'reconstructed',
                        definitionVersion: snapshot.definitionVersion,
                        agreementVersion: snapshot.agreementVersion,
                        schemaVersion: snapshot.schemaVersion,
                        recordedAt: new Date().toISOString(),
                    },
                    logLabel: 'reconstructHistoricalApplications',
                });
            } catch (error) {
                // One unreadable application must not stop the migration.
                result.failed += 1;
                result.errors.push({ applicationId: doc.id, message: String(error.message).slice(0, 200) });
                logger.error(
                    `[reconstructHistoricalApplications] Could not reconstruct ${doc.id} `
                    + `(company ${companyId}): ${error.message}`,
                );
            }
        }

        if (page.size < remaining) break;
    }

    return result;
}

exports.reconstructHistoricalApplications = onCall({
    cors: true,
    region: 'us-central1',
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '1GiB',
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const roles = request.auth.token.roles || {};
    const globalRole = request.auth.token.globalRole || roles.globalRole;
    if (globalRole !== 'super_admin') {
        throw new HttpsError('permission-denied', 'Only Super Admins can run the historical reconstruction.');
    }

    const {
        companyId,
        startAfterApplicationId = null,
        maxApplications = DEFAULT_MAX_APPLICATIONS,
        dryRun = false,
    } = request.data || {};

    if (typeof companyId !== 'string' || !companyId.trim()) {
        // One company at a time, deliberately. A migration that touches every
        // tenant at once has no safe first run.
        throw new HttpsError('invalid-argument', 'companyId is required — reconstruct one company at a time.');
    }

    const companySnap = await db.collection('companies').doc(companyId).get();
    if (!companySnap.exists) throw new HttpsError('not-found', 'Company not found.');

    const limit = Math.min(Math.max(Number(maxApplications) || DEFAULT_MAX_APPLICATIONS, 1), 1000);

    const result = await reconstructForCompany({
        companyId,
        company: companySnap.data(),
        maxApplications: limit,
        startAfterId: typeof startAfterApplicationId === 'string' ? startAfterApplicationId : null,
        dryRun: Boolean(dryRun),
    });

    logger.info(
        `[reconstructHistoricalApplications] company ${companyId}: scanned ${result.scanned}, `
        + `reconstructed ${result.reconstructed}, skipped ${result.skipped}, failed ${result.failed}`
        + (result.truncated ? `, more remain after ${result.lastApplicationId}` : '')
        + (dryRun ? ' (dry run — nothing was written)' : ''),
    );

    return { success: true, companyId, dryRun: Boolean(dryRun), ...result };
});

exports.reconstructForCompany = reconstructForCompany;
