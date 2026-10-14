/**
 * PEV — the public portal's read.
 * Token-based access for the previous employer: load the request for the
 * /verify/:token form, and record that it was opened.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../firebaseAdmin");
const { checkRateLimit } = require("../shared/rateLimiter");
const { logger } = require("firebase-functions");

// ============================================================
// 2. GET VERIFICATION (Public endpoint — token-based access)
// ============================================================
exports.getVerificationRequest = onCall({ cors: true }, async (request) => {
    const { token } = request.data || {};
    if (!token) throw new HttpsError('invalid-argument', 'Missing verification token.');

    // Rate limit: 20 reads per minute per token
    const isAllowed = await checkRateLimit(`pev_read_${token}`, 20, 60, 'closed');
    if (!isAllowed) throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a moment.');

    try {
        const docRef = db.collection('verification_requests').doc(token);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            throw new HttpsError('not-found', 'Verification request not found. The link may be invalid.');
        }

        const data = docSnap.data();

        // Check expiration
        if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
            throw new HttpsError('deadline-exceeded', 'This verification request has expired. Please contact the requesting company.');
        }

        // Check if already completed
        if (data.status === 'completed') {
            return {
                status: 'completed',
                completedAt: data.completedAt?.toDate()?.toISOString() || null,
                message: 'This verification has already been completed. Thank you.',
            };
        }

        // Track open (mark as opened if first time)
        if (['sent', 'pending', 'reminder_sent'].includes(data.status)) {
            await docRef.update({
                status: 'opened',
                openedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        // Return sanitized data (never expose internal IDs)
        return {
            status: 'pending',
            applicantName: data.applicantName,
            employerName: data.employerName,
            companyName: data.companyName,
            employmentStartDate: data.employmentStartDate,
            employmentEndDate: data.employmentEndDate,
            createdAt: data.createdAt?.toDate()?.toISOString() || null,
            expiresAt: data.expiresAt?.toDate()?.toISOString() || null,
        };

    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error('[PEV] Error fetching verification:', error);
        throw new HttpsError('internal', 'Failed to load verification request.');
    }
});
