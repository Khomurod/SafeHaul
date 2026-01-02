const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getStorage } = require("firebase-admin/storage");
const { admin, db } = require("./firebaseAdmin"); // Reuse shared instance

// --- HELPER: Validate File Type ---
const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg'
];

exports.getSignedUploadUrl = onCall({ cors: true }, async (request) => {
    // Note: This function is explicitly for GUESTS (and users), so no auth check is strictly required for generation,
    // BUT we must strictly validate the payload to prevent abuse.

    const { companyId, fileName, contentType, folder } = request.data;

    // 1. Validation
    if (!companyId || !fileName || !contentType) {
        throw new HttpsError('invalid-argument', 'Missing file parameters.');
    }

    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
        throw new HttpsError('invalid-argument', 'Invalid file type. Only PDF and Images are allowed.');
    }

    // Default to 'applications' if not specified or invalid
    const targetFolder = (folder === 'leads') ? 'leads' : 'applications';

    // 2. Generate Safe Filename
    // Use timestamp + random string to prevent collisions and guessing
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const finalPath = `companies/${companyId}/${targetFolder}/guest_uploads/${uniqueId}_${cleanFileName}`;

    try {
        const bucket = getStorage().bucket();
        const file = bucket.file(finalPath);

        // 3. Generate Signed URL
        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'write',
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            contentType: contentType,
        });

        return {
            uploadUrl: url,
            storagePath: finalPath,
            publicUrl: `https://storage.googleapis.com/${bucket.name}/${finalPath}` // Or a download token logic if private
        };
    } catch (e) {
        console.error("Error generating signed URL:", e);
        throw new HttpsError('internal', 'Could not generate upload URL.');
    }
});
