/**
 * applicationOriginalPdf.js
 * =========================
 * Serves the PRESERVED original application PDF, and audits every access.
 *
 * WHY A CALLABLE RATHER THAN A STORAGE RULE
 * -----------------------------------------
 * This document may carry the applicant's full Social Security Number. The owner
 * decided the authorized original may show it in full — which is defensible only
 * if every path to it is authorized and every access leaves a record. A Storage
 * rule granting company staff direct bucket reads would satisfy the first and
 * fail the second: a token holder could pull the file and nothing would know.
 *
 * So `application_originals/**` deliberately has no Storage rule at all
 * (Firebase default-denies), and this callable is the only way in. It:
 *   1. requires authentication;
 *   2. authorizes the caller against the owning company, or as the applicant;
 *   3. resolves the requested submission — the ORIGINAL by default;
 *   4. returns a short-lived signed URL for the STORED BYTES, never a fresh
 *      render;
 *   5. writes an audit record naming who, what and when — before returning.
 *
 * The audit write is awaited rather than fired and forgotten: an access that
 * could not be recorded is refused, because an unauditable read of this file is
 * exactly what the design exists to prevent.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { admin, db, storage } = require('./firebaseAdmin');
const { assertCompanyAccess } = require('./shared/companyAccess');
const { ORIGINAL_PDF_PREFIX, originalPdfPath } = require('./shared/preserveApplicationPdf');

/** Signed-URL lifetime. Long enough to open and save, short enough not to leak. */
const URL_TTL_MS = 10 * 60 * 1000;

/**
 * May this caller see this application's preserved original?
 *
 * Mirrors the Firestore read rule on the application document: company staff,
 * super admins, and the applicant themselves. Returns the role that granted
 * access, which the audit record names.
 */
async function resolveAccess({ request, companyId, applicationSnap }) {
    const uid = request.auth.uid;

    try {
        await assertCompanyAccess(uid, companyId);
        return 'company';
    } catch (error) {
        // Only a DENIAL falls through to the applicant check. Anything else — an
        // unavailable Firestore, a claims lookup that threw — is a failure to
        // determine access, and treating that as "not company staff" would turn
        // an outage into a silent, confusing denial for a legitimate recruiter.
        if (!String(error?.code || '').includes('permission-denied')) throw error;
    }

    const data = applicationSnap.data() || {};
    const isOwner = data.applicantId === uid
        || data.driverId === uid
        || (typeof data.email === 'string'
            && typeof request.auth.token?.email === 'string'
            && request.auth.token.email_verified === true
            && data.email.toLowerCase() === request.auth.token.email.toLowerCase());

    if (isOwner) return 'applicant';

    throw new HttpsError('permission-denied', 'You do not have access to this application.');
}

/** Write the audit record. Throws on failure — see the module note. */
async function recordAccess({ companyId, applicationId, snapshotId, uid, role, request }) {
    const name = request.auth.token?.name || request.auth.token?.email || 'Unknown user';
    await db
        .collection('companies').doc(companyId)
        .collection('applications').doc(applicationId)
        .collection('activity_logs')
        .add({
            action: 'Original Application PDF Accessed',
            details: `${role === 'applicant' ? 'The applicant' : 'A company user'} opened the preserved `
                + `${snapshotId === 'v1' ? 'original' : `resubmission (${snapshotId})`} application PDF, `
                + 'which contains the full Social Security Number.',
            type: 'security',
            companyId,
            performedBy: uid,
            performedByName: name,
            accessRole: role,
            snapshotId,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
}

exports.getApplicationOriginalPdfUrl = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const { companyId, applicationId, snapshotId: requestedSnapshotId } = request.data || {};

    if (typeof companyId !== 'string' || !companyId.trim()) {
        throw new HttpsError('invalid-argument', 'companyId is required.');
    }
    if (typeof applicationId !== 'string' || !applicationId.trim()) {
        throw new HttpsError('invalid-argument', 'applicationId is required.');
    }

    // `v1` is the ORIGINAL and is what an unqualified request means. Any other
    // value must be a snapshot id, matched strictly so a caller cannot walk out
    // of the tenant with `../`.
    const snapshotId = typeof requestedSnapshotId === 'string' && requestedSnapshotId.trim()
        ? requestedSnapshotId.trim()
        : 'v1';
    if (!/^v[1-9][0-9]{0,2}$/.test(snapshotId)) {
        throw new HttpsError('invalid-argument', 'Invalid submission version.');
    }

    const applicationRef = db
        .collection('companies').doc(companyId)
        .collection('applications').doc(applicationId);
    const applicationSnap = await applicationRef.get();
    if (!applicationSnap.exists) {
        throw new HttpsError('not-found', 'Application not found.');
    }

    const role = await resolveAccess({ request, companyId, applicationSnap });

    const storagePath = originalPdfPath({ companyId, applicationId, snapshotId });
    const file = storage.bucket().file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
        // Deliberately distinguishable from "denied": a recruiter needs to know
        // whether the record predates preservation or whether they may not see it.
        throw new HttpsError(
            'not-found',
            'No preserved application PDF exists for this submission yet.',
        );
    }

    const [metadata] = await file.getMetadata();
    const fileName = metadata?.metadata?.safehaulFileName || 'Driver-Application.pdf';

    // Audited BEFORE the URL is issued. A read we could not record is a read we
    // do not permit.
    await recordAccess({ companyId, applicationId, snapshotId, uid: request.auth.uid, role, request });

    const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + URL_TTL_MS,
        // Serve it as a download with the human filename rather than the storage
        // object name, which is an internal identifier.
        responseDisposition: `attachment; filename="${fileName}"`,
    });

    // The log line names the application, never the applicant and never the path
    // component that identifies the file — logs are not an access channel.
    logger.info(
        `[getApplicationOriginalPdfUrl] ${role} access to preserved ${snapshotId} `
        + `for application ${applicationId} (company ${companyId})`,
    );

    return {
        success: true,
        url,
        fileName,
        snapshotId,
        isOriginal: snapshotId === 'v1',
        expiresInSeconds: URL_TTL_MS / 1000,
    };
});

exports.ORIGINAL_PDF_PREFIX = ORIGINAL_PDF_PREFIX;
