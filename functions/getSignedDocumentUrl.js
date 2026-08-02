/**
 * getSignedDocumentUrl.js
 * =======================
 * Generates a time-limited signed download URL for secure documents
 * (e-signature envelopes) stored in Cloud Storage.
 *
 * This bypasses Storage Security Rules by using Admin SDK credentials,
 * while enforcing access through server-side company access checks.
 *
 * Security:
 *  - Requires authentication
 *  - Validates that the caller belongs to the company that owns the file
 *  - Path must start with `secure_documents/{companyId}/`
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { storage } = require("./firebaseAdmin");
const { logger } = require("firebase-functions");
const { assertCompanyAccessForRequest } = require("./shared/companyAccess");

exports.getSignedDocumentUrl = onCall({ cors: true }, async (request) => {
    // 1. Auth check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Login required.');
    }

    const { storagePath } = request.data || {};

    if (!storagePath || typeof storagePath !== 'string') {
        throw new HttpsError('invalid-argument', 'Missing or invalid storagePath.');
    }

    // 2. Security: Validate the path structure
    //    Must be: secure_documents/{companyId}/...
    const pathParts = storagePath.split('/');
    if (pathParts[0] !== 'secure_documents' || pathParts.length < 3) {
        throw new HttpsError('invalid-argument', 'Invalid storage path format. Expected: secure_documents/{companyId}/...');
    }

    const companyId = pathParts[1];

    // 3. Security: Verify caller belongs to the company
    await assertCompanyAccessForRequest(request, companyId, 'getSignedDocumentUrl');

    // 4. Generate signed URL (1 hour expiry)
    try {
        const bucket = storage.bucket();
        const file = bucket.file(storagePath);

        // Verify file exists
        const [exists] = await file.exists();
        if (!exists) {
            throw new HttpsError('not-found', 'The requested file does not exist. It may have been deleted or moved.');
        }

        const [signedUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000, // 1 hour
        });

        logger.info(`[getSignedDocumentUrl] Generated signed URL for: ${storagePath}`);
        return { success: true, url: signedUrl };

    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error('[getSignedDocumentUrl] Error generating signed URL:', error);
        throw new HttpsError('internal', 'Failed to generate download URL.');
    }
});
