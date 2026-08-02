/**
 * getSignedGuestUploadUrl.js
 * ==========================
 * Issues a short-lived signed read URL for files in guest_uploads paths.
 * Guests cannot read via Storage rules; this callable is the preview path.
 */

const functions = require('firebase-functions/v1');
const { db, storage } = require('./firebaseAdmin');
const { checkRateLimit } = require('./shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('./shared/companyTenant');

const GUEST_READ_TTL_MS = 15 * 60 * 1000;
const ALLOWED_FOLDERS = ['applications', 'autofill'];

function validateGuestUploadPath(companyId, storagePath) {
    if (!storagePath || typeof storagePath !== 'string') {
        return { ok: false, reason: 'Missing or invalid storagePath.' };
    }

    const parts = storagePath.split('/');
    if (
        parts.length < 5 ||
        parts[0] !== 'companies' ||
        parts[1] !== companyId ||
        !ALLOWED_FOLDERS.includes(parts[2]) ||
        parts[3] !== 'guest_uploads'
    ) {
        return { ok: false, reason: 'Invalid guest upload path format.' };
    }

    const fileName = parts.slice(4).join('/');
    if (!fileName || fileName.includes('..')) {
        return { ok: false, reason: 'Invalid guest upload file name.' };
    }

    return { ok: true };
}

exports.getSignedGuestUploadUrl = functions.https.onCall(async (data, context) => {
    const { companyId, storagePath } = data || {};

    if (!companyId || typeof companyId !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Missing or invalid companyId.');
    }

    const pathCheck = validateGuestUploadPath(companyId, storagePath);
    if (!pathCheck.ok) {
        throw new functions.https.HttpsError('invalid-argument', pathCheck.reason);
    }

    const ip = context.rawRequest?.ip || 'unknown_guest';
    const isAllowed = await checkRateLimit(`guest_read_${ip}`, 20, 60, 'closed');
    if (!isAllowed) {
        throw new functions.https.HttpsError(
            'resource-exhausted',
            'Too many download requests. Please wait a moment and try again.'
        );
    }

    await assertCompanyAcceptingIntake(db, companyId);

    try {
        const bucket = storage.bucket();
        const file = bucket.file(storagePath);
        const [exists] = await file.exists();
        if (!exists) {
            throw new functions.https.HttpsError('not-found', 'The requested file does not exist in storage.');
        }

        const [signedUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + GUEST_READ_TTL_MS,
        });

        return { success: true, url: signedUrl };
    } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.error('[getSignedGuestUploadUrl] Error generating signed URL:', error);
        throw new functions.https.HttpsError('internal', 'Failed to generate download URL.');
    }
});
