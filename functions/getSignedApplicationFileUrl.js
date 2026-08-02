/**
 * getSignedApplicationFileUrl.js
 * ==============================
 * Generates a time-limited signed download URL for driver-uploaded application
 * files (CDL front/back, medical card, etc.) stored under a company's
 * `guest_uploads` path in Cloud Storage.
 *
 * Why this exists: guest application uploads persist a 15-minute signed URL on
 * the application document, which is long expired by the time a recruiter opens
 * the dossier. The company-side reader must re-sign at view time. Doing it in a
 * callable (Admin SDK) bypasses the Storage rule — whose `guest_uploads` read is
 * gated on the narrow `companyTeamIds` claim with no super-admin bypass — while
 * still enforcing access server-side via the canonical company-access check
 * (super_admin OR roles[companyId] team role OR membership/owner).
 *
 * Security:
 *  - Requires authentication
 *  - Validates the path is companies/{companyId}/(applications|autofill)/guest_uploads/...
 *  - Verifies the caller may access {companyId}
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { storage } = require("./firebaseAdmin");
const { logger } = require("firebase-functions");
const { assertCompanyAccessForRequest } = require("./shared/companyAccess");

exports.getSignedApplicationFileUrl = onCall({ cors: true }, async (request) => {
    // 1. Auth check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Login required.');
    }

    const { storagePath } = request.data || {};

    if (!storagePath || typeof storagePath !== 'string') {
        throw new HttpsError('invalid-argument', 'Missing or invalid storagePath.');
    }

    // 2. Security: validate the path structure
    //    Must be: companies/{companyId}/(applications|autofill)/guest_uploads/...
    const pathParts = storagePath.split('/');
    const isGuestUploadPath =
        pathParts[0] === 'companies' &&
        (pathParts[2] === 'applications' || pathParts[2] === 'autofill') &&
        pathParts[3] === 'guest_uploads' &&
        pathParts.length >= 5;
    if (!isGuestUploadPath) {
        throw new HttpsError(
            'invalid-argument',
            'Invalid storage path format. Expected: companies/{companyId}/(applications|autofill)/guest_uploads/...',
        );
    }

    const companyId = pathParts[1];

    // 3. Security: verify caller belongs to the company (or is a super admin)
    await assertCompanyAccessForRequest(request, companyId, 'getSignedApplicationFileUrl');

    // 4. Generate signed URL (1 hour expiry)
    try {
        const bucket = storage.bucket();
        const file = bucket.file(storagePath);

        const [exists] = await file.exists();
        if (!exists) {
            throw new HttpsError('not-found', 'The requested file does not exist. It may have been deleted or moved.');
        }

        const [signedUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000, // 1 hour
        });

        logger.info(`[getSignedApplicationFileUrl] Generated signed URL for: ${storagePath}`);
        return { success: true, url: signedUrl };

    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error('[getSignedApplicationFileUrl] Error generating signed URL:', error);
        throw new HttpsError('internal', 'Failed to generate download URL.');
    }
});
