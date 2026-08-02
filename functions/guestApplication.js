/**
 * Guest application submission via callable function.
 * Uses Admin SDK writes, so Firestore client rules do not block guest intake.
 */

const functions = require('firebase-functions/v1');
const { db } = require('./firebaseAdmin');
const { assertCompanyAcceptingIntake } = require('./shared/companyTenant');
const { assertRequiredUploads, buildApplicationDoc } = require('./shared/buildApplicationDoc');
const { upsertApplicationDoc } = require('./shared/upsertApplicationDoc');

exports.submitGuestApplication = functions
    .runWith({ memory: '256MB', timeoutSeconds: 30 })
    .https.onCall(async (data, context) => {
        const { checkRateLimit } = require('./shared/rateLimiter');
        const clientIp = context.rawRequest?.ip || 'unknown';
        const allowed = await checkRateLimit(`guest_submit_${clientIp}`, 5, 60, 'closed');
        if (!allowed) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Too many submissions. Please try again in a minute.'
            );
        }

        const { companyId, email, phone, signature, formData: rawFormData } = data || {};
        const normalizedFormData = rawFormData && typeof rawFormData === 'object' ? rawFormData : {};

        if (!companyId || typeof companyId !== 'string') {
            throw new functions.https.HttpsError('invalid-argument', 'Missing or invalid companyId.');
        }

        if (data?.companyId && data.companyId !== companyId) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'companyId in payload must match submission target.'
            );
        }

        if (normalizedFormData.companyId && normalizedFormData.companyId !== companyId) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'companyId in payload must match submission target.'
            );
        }

        if (!email && !phone) {
            throw new functions.https.HttpsError('invalid-argument', 'At least one of email or phone is required.');
        }

        if (!signature) {
            throw new functions.https.HttpsError('invalid-argument', 'Signature is required.');
        }

        const companyData = await assertCompanyAcceptingIntake(db, companyId);
        let companyName = companyData.companyName || 'Unknown Company';
        let applicationConfig = companyData.applicationConfig || null;

        try {
            const publicSnap = await db.collection('public_profiles').doc(companyId).get();
            if (publicSnap.exists) {
                const publicData = publicSnap.data() || {};
                companyName = publicData.companyName || companyName;
                applicationConfig = publicData.applicationConfig ?? applicationConfig;
            }
        } catch (err) {
            console.error('[submitGuestApplication] Public profile lookup error:', err);
        }

        assertRequiredUploads(applicationConfig, normalizedFormData);

        const {
            applicantKeyFull,
            applicationId,
            confirmationNumber,
            applicationDoc,
            now,
        } = buildApplicationDoc({
            companyId,
            companyName,
            email,
            phone,
            signature,
            formData: normalizedFormData,
        });

        try {
            const result = await upsertApplicationDoc({
                db,
                companyId,
                applicationId,
                applicantKeyFull,
                applicationDoc,
                now,
                logLabel: 'submitGuestApplication',
            });
            return {
                ...result,
                confirmationNumber: result.confirmationNumber || confirmationNumber,
            };
        } catch (writeError) {
            if (writeError instanceof functions.https.HttpsError) {
                throw writeError;
            }
            console.error('[submitGuestApplication] Firestore write failed:', writeError);
            throw new functions.https.HttpsError(
                'internal',
                'Failed to save application. Please try again.'
            );
        }
    });
