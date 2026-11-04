/**
 * PEV — the public portal's read.
 * Token-based access for the previous employer: load the request for the
 * /verify/:token form, and record that it was opened (the first open also on
 * the employer row, where the team sees it).
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../firebaseAdmin");
const { checkRateLimit } = require("../shared/rateLimiter");
const { logger } = require("firebase-functions");
const { SUPERSEDED_MESSAGE } = require("./requestLifecycle");
const { mirrorOntoEmployer, recordRefOf } = require("./employerMirror");

/** The statuses an open moves to `opened`. */
const OPENABLE = ['sent', 'pending', 'reminder_sent'];

/**
 * The first open, on the employer row: the team cannot read the request. Once
 * per request (a resend clears the row's `openedAt`); the form shows whatever
 * happens here.
 */
async function mirrorFirstOpen(request) {
    const at = new Date().toISOString();
    try {
        await mirrorOntoEmployer(recordRefOf(request), request, (verification) => {
            if (verification.openedAt) return false;
            verification.openedAt = at;
            verification.history.push({ action: 'Employer opened the link', timestamp: at });
        });
    } catch (error) {
        logger.error('[PEV] The first open could not be copied onto the employer row.', error);
    }
}

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

        // A newer request for this employer replaced it (./requestLifecycle.js).
        if (data.status === 'superseded') throw new HttpsError('not-found', SUPERSEDED_MESSAGE);

        // Check if already completed
        if (data.status === 'completed') {
            return {
                status: 'completed',
                completedAt: data.completedAt?.toDate()?.toISOString() || null,
                message: 'This verification has already been completed. Thank you.',
            };
        }

        // Track open. `openedAt` is the FIRST open: a reminder sets the status
        // back, and the open after it must not move the date.
        if (OPENABLE.includes(data.status)) {
            const firstOpen = await db.runTransaction(async (tx) => {
                const current = (await tx.get(docRef)).data() || {};
                if (!OPENABLE.includes(current.status)) return false;
                const first = !current.openedAt;
                tx.update(docRef, {
                    status: 'opened',
                    ...(first ? { openedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
                });
                return first;
            });
            if (firstOpen) await mirrorFirstOpen(data);
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
