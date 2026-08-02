/**
 * deleteApplication.js
 * ====================
 * Company-admin hard delete of a driver application (or company lead), with
 * cascade: removes all subcollections (activity_logs, dq_files, general_documents,
 * internal_notes, …) and best-effort cleanup of the uploaded files in Storage.
 *
 * Security:
 *  - Requires authentication
 *  - Restricted to company_admin (or super admin) via assertCompanyAdminStrict
 *  - Verifies the target doc actually belongs to {companyId} (tenant safety)
 *
 * Mirrors the cascade pattern of deleteSandboxApplication / deleteCompany.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, storage } = require("./firebaseAdmin");
const { logger } = require("firebase-functions");
const { assertCompanyAdminStrict } = require("./shared/companyAccess");

const ALLOWED_COLLECTIONS = new Set(['applications', 'leads']);

/** Collect Storage object paths from an application doc's file fields ({ storagePath } objects). */
function collectStoragePaths(data) {
    const paths = [];
    for (const value of Object.values(data || {})) {
        if (value && typeof value === 'object' && typeof value.storagePath === 'string' && value.storagePath) {
            paths.push(value.storagePath);
        }
    }
    return paths;
}

exports.deleteApplication = onCall({ cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Login required.');
    }

    const { companyId, applicationId, collectionName = 'applications' } = request.data || {};
    if (!companyId || !applicationId || typeof companyId !== 'string' || typeof applicationId !== 'string') {
        throw new HttpsError('invalid-argument', 'companyId and applicationId are required.');
    }
    if (!ALLOWED_COLLECTIONS.has(collectionName)) {
        throw new HttpsError('invalid-argument', 'Invalid collectionName.');
    }

    // RBAC: company_admin or super admin only (stricter than generic team access).
    await assertCompanyAdminStrict(request.auth.uid, companyId);

    const ref = db.collection('companies').doc(companyId).collection(collectionName).doc(applicationId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new HttpsError('not-found', 'Application not found.');
    }

    const data = snap.data() || {};

    // Best-effort Storage cleanup BEFORE the doc is deleted (so we can read paths).
    // Per-file deletes catch the guest_uploads shared-folder files referenced on the
    // doc; the prefix sweep catches admin-uploaded per-application files.
    try {
        const bucket = storage.bucket();
        const filePaths = collectStoragePaths(data);
        await Promise.allSettled([
            ...filePaths.map((p) => bucket.file(p).delete()),
            bucket.deleteFiles({ prefix: `companies/${companyId}/${collectionName}/${applicationId}/` }),
        ]);
    } catch (err) {
        logger.warn(`[deleteApplication] Storage cleanup partial failure for ${applicationId}: ${err?.message || err}`);
    }

    // Cascade delete the document and all of its subcollections.
    await db.recursiveDelete(ref);

    logger.info(`[deleteApplication] ${collectionName}/${applicationId} deleted for company ${companyId} by ${request.auth.uid}`);
    return { success: true, applicationId, collectionName };
});

exports.collectStoragePaths = collectStoragePaths;
