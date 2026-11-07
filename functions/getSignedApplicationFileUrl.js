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
 *
 * `getSignedApplicationFileUrls` signs a record's files in one call, each one
 * exactly as `getSignedApplicationFileUrl` signs it (`signApplicationFile`): the
 * same path rule, the same access check, the same one-hour link, and a file the
 * single call would refuse is refused alone, with the single call's code and
 * message. The single call stays: the Production site and Open file call it.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { assertCompanyAccessForRequest } = require("./shared/companyAccess");
const { signReadUrl } = require("./shared/signReadUrl");

/** The most files one `getSignedApplicationFileUrls` call signs: the eight driver uploads the dossier shows (`useAppFetch.js`). */
const MAX_FILES_PER_CALL = 8;

/**
 * The company a driver-upload path belongs to.
 * Must be: companies/{companyId}/(applications|autofill)/guest_uploads/...
 */
function guestUploadCompanyId(storagePath) {
    if (!storagePath || typeof storagePath !== 'string') {
        throw new HttpsError('invalid-argument', 'Missing or invalid storagePath.');
    }
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
    return pathParts[1];
}

/**
 * One file: the path checked, then the caller's access to its company
 * (`checkAccess`, which throws when refused), then a link valid for one hour.
 * Throws the HttpsError the caller answers with.
 */
async function signApplicationFile(storagePath, checkAccess, label) {
    const companyId = guestUploadCompanyId(storagePath);
    await checkAccess(companyId);
    return signReadUrl(storagePath, { label });
}

exports.getSignedApplicationFileUrl = onCall({ cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Login required.');
    }
    const { storagePath } = request.data || {};
    const label = 'getSignedApplicationFileUrl';
    const url = await signApplicationFile(
        storagePath,
        (companyId) => assertCompanyAccessForRequest(request, companyId, label),
        label,
    );
    return { success: true, url };
});

/** What a refused file answers: the single call's code and message. */
function refusalOf(err, storagePath) {
    if (err instanceof HttpsError) return { code: err.code, message: err.message };
    // The single call's `onCall` answers any other failure as `internal`.
    logger.error('[getSignedApplicationFileUrls] Unexpected failure for one file:', storagePath, err);
    return { code: 'internal', message: 'INTERNAL' };
}

/**
 * Takes `{ storagePaths }`, 1 to 8 strings, and answers
 * `{ success: true, results: { [storagePath]: { url } | { error: { code, message } } } }`,
 * one entry per distinct path. The caller's access to each company named is
 * checked once in this call, as the single call checks it; nothing is kept
 * after the call.
 */
exports.getSignedApplicationFileUrls = onCall({ cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Login required.');
    }
    const { storagePaths } = request.data || {};
    if (
        !Array.isArray(storagePaths)
        || storagePaths.length === 0
        || storagePaths.length > MAX_FILES_PER_CALL
        || !storagePaths.every((path) => typeof path === 'string' && path)
    ) {
        throw new HttpsError('invalid-argument', `storagePaths must list 1 to ${MAX_FILES_PER_CALL} file paths.`);
    }

    const label = 'getSignedApplicationFileUrls';
    const accessChecks = new Map();
    const checkAccess = (companyId) => {
        if (!accessChecks.has(companyId)) {
            accessChecks.set(companyId, assertCompanyAccessForRequest(request, companyId, label));
        }
        return accessChecks.get(companyId);
    };

    const results = {};
    await Promise.all([...new Set(storagePaths)].map(async (storagePath) => {
        try {
            results[storagePath] = { url: await signApplicationFile(storagePath, checkAccess, label) };
        } catch (err) {
            results[storagePath] = { error: refusalOf(err, storagePath) };
        }
    }));
    return { success: true, results };
});
