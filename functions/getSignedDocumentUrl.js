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
const { assertCompanyAccessForRequest } = require("./shared/companyAccess");
const { signReadUrl } = require("./shared/signReadUrl");

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

    // 4. A link valid for one hour
    const url = await signReadUrl(storagePath, { label: 'getSignedDocumentUrl' });
    return { success: true, url };
});
