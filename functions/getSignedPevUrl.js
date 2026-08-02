/**
 * getSignedPevUrl.js
 * ==================
 * Generates a time-limited signed download URL for PEV result PDFs stored in Cloud Storage.
 *
 * The PEV-BRK-3 fix correctly changed the backend to store permanent Cloud Storage paths
 * instead of expiring signed URLs. This companion function generates fresh signed URLs
 * on demand when a company admin clicks "View Result" in the PEV tab.
 *
 * Security:
 *  - Requires authentication
 *  - Validates that the caller belongs to the company that owns the file
 *  - Path must start with `companies/` and contain `pev_results/` or `pev_signatures/`
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { storage } = require("./firebaseAdmin");
const { logger } = require("firebase-functions");
const { assertCompanyAccessForRequest } = require("./shared/companyAccess");

exports.getSignedPevUrl = onCall({ cors: true }, async (request) => {
    // 1. Auth check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Login required.');
    }

    const { storagePath } = request.data || {};

    if (!storagePath || typeof storagePath !== 'string') {
        throw new HttpsError('invalid-argument', 'Missing or invalid storagePath.');
    }

    // 2. Security: Validate the path structure
    //    Must be: companies/{companyId}/.../(pev_results|pev_signatures)/...
    const pathParts = storagePath.split('/');
    if (pathParts[0] !== 'companies' || pathParts.length < 4) {
        throw new HttpsError('invalid-argument', 'Invalid storage path format.');
    }

    const companyId = pathParts[1];

    // Ensure the path is for PEV-related files only
    const isPevPath = storagePath.includes('/pev_results/') || storagePath.includes('/pev_signatures/');
    if (!isPevPath) {
        throw new HttpsError('invalid-argument', 'This endpoint only serves PEV result files.');
    }

    // 3. Security: Verify caller belongs to the company.
    await assertCompanyAccessForRequest(request, companyId, 'getSignedPevUrl');

    // 4. Generate signed URL (1 hour expiry — enough time to view/download)
    try {
        const bucket = storage.bucket();
        const file = bucket.file(storagePath);

        // Verify file exists
        const [exists] = await file.exists();
        if (!exists) {
            throw new HttpsError('not-found', 'The requested file does not exist in storage.');
        }

        const [signedUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000, // 1 hour
        });

        logger.info(`[getSignedPevUrl] Generated signed URL for: ${storagePath}`);
        return { success: true, url: signedUrl };

    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error('[getSignedPevUrl] Error generating signed URL:', error);
        throw new HttpsError('internal', 'Failed to generate download URL.');
    }
});
