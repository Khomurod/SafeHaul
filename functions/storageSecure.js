const functions = require("firebase-functions/v1");
const { db } = require("./firebaseAdmin");
const { checkRateLimit } = require("./shared/rateLimiter"); // C3 FIX
const { assertCompanyAcceptingIntake } = require("./shared/companyTenant");

// --- HELPER: Validate File Type ---
const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/heic',
    'image/heif',
];

/**
 * Callable name kept as getSignedUploadUrl for backward compatibility.
 * Returns a server-approved Storage path only — the browser uploads via the
 * Firebase Storage SDK (uploadBytes → firebasestorage.googleapis.com), avoiding
 * signed URL PUTs to storage.googleapis.com and their bucket CORS pitfalls.
 */
exports.getSignedUploadUrl = functions.https.onCall(async (data, context) => {
    const { companyId, fileName, fileType, folder: rawFolder } = data;

    if (!context.auth) {
        const ip = context.rawRequest?.ip || 'unknown_guest';
        const isAllowed = await checkRateLimit(`upload_guest_${ip}`, 10, 60, 'closed');
        if (!isAllowed) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Too many upload requests. Please wait a moment and try again.'
            );
        }
    }

    if (!companyId || !fileName || !fileType) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing file parameters (companyId, fileName, or fileType).');
    }

    if (!ALLOWED_MIME_TYPES.includes(fileType)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid file type. Only PDF and Images are allowed.');
    }

    await assertCompanyAcceptingIntake(db, companyId);

    const folder = ['applications', 'autofill'].includes(String(rawFolder || '').trim())
        ? String(rawFolder).trim()
        : 'applications';
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const storagePath = `companies/${companyId}/${folder}/guest_uploads/${uniqueId}_${cleanFileName}`;

    return { storagePath };
});
