const { HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { storage } = require("../firebaseAdmin");

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * A short-lived v4 link to read one Storage file. The callable that asks has
 * already checked the path and the caller; this only signs. A missing file is
 * `not-found`; any other failure is logged under `label` and becomes `internal`.
 */
async function signReadUrl(storagePath, { label, ttlMs = ONE_HOUR_MS }) {
    try {
        const file = storage.bucket().file(storagePath);
        const [exists] = await file.exists();
        if (!exists) {
            throw new HttpsError('not-found', 'The requested file does not exist. It may have been deleted or moved.');
        }
        const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + ttlMs });
        return url;
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error(`[${label}] Error generating signed URL:`, error);
        throw new HttpsError('internal', 'Failed to generate download URL.');
    }
}

module.exports = { signReadUrl };
