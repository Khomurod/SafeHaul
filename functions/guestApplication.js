/**
 * Guest Application Submission — Cloud Function
 *
 * Uses Admin SDK to write guest applications to Firestore,
 * completely bypassing security rules. This guarantees delivery
 * regardless of App Check, auth state, or reCAPTCHA availability.
 *
 * @module guestApplication
 */

const functions = require('firebase-functions/v1');
const { db } = require('./firebaseAdmin');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');

// ---------- Helpers ----------

/**
 * Generate a deterministic application ID (server-side version).
 * SHA-256 of "companyId:email:phone", matching the client-side logic.
 */
function generateApplicationId(companyId, email, phone) {
    const normalizedEmail = (email || '').toLowerCase().trim();
    const normalizedPhone = (phone || '').replace(/\D/g, '').trim();
    const input = `${companyId}:${normalizedEmail}:${normalizedPhone}`;
    const fullHash = crypto.createHash('sha256').update(input).digest('hex');
    // CRITICAL: Must match client-side truncation (applicationId.js line 88)
    // Client uses hash.substring(0, 20) — we must do the same
    return fullHash.substring(0, 20);
}

/**
 * Generate a human-readable confirmation number.
 */
function generateConfirmationNumber() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I,O,0,1 for readability
    let code = 'SH-';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Recursively replace `undefined` with `null` (Firestore rejects undefined).
 */
function sanitizeData(data) {
    if (data === undefined) return null;
    if (data === null) return null;
    if (data instanceof Date) return data.toISOString();
    if (Array.isArray(data)) return data.map(sanitizeData);
    if (typeof data === 'object') {
        const sanitized = {};
        for (const key of Object.keys(data)) {
            sanitized[key] = sanitizeData(data[key]);
        }
        return sanitized;
    }
    return data;
}

// ---------- Cloud Function ----------

exports.submitGuestApplication = functions
    .runWith({ memory: '256MB', timeoutSeconds: 30 })
    .https.onCall(async (data, context) => {
        // 1. App Check — log warning but do NOT reject
        //    (the whole point is to never block guest submissions)
        if (!context.app && !process.env.FUNCTIONS_EMULATOR) {
            console.warn('[submitGuestApplication] Called without App Check token');
        }

        // 2. Extract & validate required fields
        const { companyId, email, phone, signature, formData: rawFormData } = data || {};

        if (!companyId || typeof companyId !== 'string') {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Missing or invalid companyId.'
            );
        }

        if (!email && !phone) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'At least one of email or phone is required.'
            );
        }

        if (!signature) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Signature is required.'
            );
        }

        // 3. Verify company exists (check public_profiles first, fall back to companies)
        let companyName = 'Unknown Company';
        try {
            const publicSnap = await db.collection('public_profiles').doc(companyId).get();
            if (publicSnap.exists) {
                companyName = publicSnap.data().companyName || companyName;
            } else {
                const companySnap = await db.collection('companies').doc(companyId).get();
                if (!companySnap.exists) {
                    throw new functions.https.HttpsError(
                        'not-found',
                        'Company not found.'
                    );
                }
                companyName = companySnap.data().companyName || companyName;
            }
        } catch (err) {
            if (err instanceof functions.https.HttpsError) throw err;
            console.error('[submitGuestApplication] Company lookup error:', err);
            // Continue anyway — don't block the submission
        }

        // 4. Generate deterministic ID & confirmation number (server-side)
        const applicationId = generateApplicationId(companyId, email, phone);
        const confirmationNumber = generateConfirmationNumber();

        // 5. Build final document
        const now = FieldValue.serverTimestamp();
        const applicationDoc = sanitizeData({
            // Spread all form data from the client
            ...(rawFormData || {}),
            // Override / ensure critical fields
            applicantId: applicationId,
            applicationId: applicationId,
            confirmationNumber: confirmationNumber,
            email: (email || '').toLowerCase().trim(),
            phone: phone || '',
            signature: signature,
            signatureType: rawFormData?.signatureType || 'drawn',
            companyId: companyId,
            companyName: companyName,
            status: 'New Application',
            sourceType: rawFormData?.sourceType || 'Public Application',
            sourceSlug: rawFormData?.sourceSlug || null,
            recruiterCode: rawFormData?.recruiterCode || null,
            // Ensure arrays
            employers: Array.isArray(rawFormData?.employers) ? rawFormData.employers : [],
            violations: Array.isArray(rawFormData?.violations) ? rawFormData.violations : [],
            accidents: Array.isArray(rawFormData?.accidents) ? rawFormData.accidents : [],
            schools: Array.isArray(rawFormData?.schools) ? rawFormData.schools : [],
            military: Array.isArray(rawFormData?.military) ? rawFormData.military : [],
            // Lifecycle tracking
            lifecycle: {
                status: 'submitted',
                submittedAt: new Date().toISOString(),
                clientVersion: rawFormData?.lifecycle?.clientVersion || '2.0-bulletproof',
                isGuest: true,
                processedViaFunction: true,
            },
        });

        // Add server timestamps (can't use FieldValue inside sanitizeData)
        applicationDoc.submittedAt = now;
        applicationDoc.createdAt = now;

        // 6. Write to Firestore using Admin SDK (BYPASSES ALL RULES)
        try {
            const docRef = db
                .collection('companies')
                .doc(companyId)
                .collection('applications')
                .doc(applicationId);

            // Use set() — creates if new, overwrites if exists (idempotent for retries)
            await docRef.set(applicationDoc, { merge: true });

            console.log(
                `[submitGuestApplication] ✅ Wrote application ${applicationId} for company ${companyId}`
            );

            return {
                success: true,
                applicationId,
                confirmationNumber,
            };
        } catch (writeError) {
            console.error('[submitGuestApplication] Firestore write failed:', writeError);
            throw new functions.https.HttpsError(
                'internal',
                'Failed to save application. Please try again.'
            );
        }
    });
