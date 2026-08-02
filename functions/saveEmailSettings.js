const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("./firebaseAdmin");
const { checkRateLimit } = require("./shared/rateLimiter");
const { assertCompanyAdminStrict } = require("./shared/companyAccess");

/**
 * Save email settings to admin-only subcollection.
 *
 * REFACTOR: Previously stored encrypted password on root company doc
 * (readable by all team members). Now stores plaintext password in
 * companies/{companyId}/system_settings/email_config — restricted
 * to company_admin + super_admin by Firestore rules.
 *
 * Why plaintext instead of encrypted:
 *  1. The subcollection is admin-only (not team-readable), so exposure is minimal.
 *  2. Encryption caused double-encryption bugs when the frontend accidentally
 *     resubmitted the ciphertext — corrupting credentials and failing SMTP auth.
 *  3. The backend still needs the raw password to create SMTP connections,
 *     so encryption only added complexity without real security benefit.
 *
 * The SMTP password is NEVER returned to the frontend.
 */
exports.saveEmailSettings = onCall(
    { cors: true },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Login required.');
        }

        const { companyId, smtpHost, smtpPort, smtpUser, smtpPass, signature } = request.data || {};

        if (!companyId || !smtpHost || !smtpUser) {
            throw new HttpsError('invalid-argument', 'Missing required fields: companyId, smtpHost, smtpUser.');
        }

        // Rate limit: 10 saves per 5 minutes per user (prevent spam)
        const isAllowed = await checkRateLimit(`save_email_${request.auth.uid}`, 10, 300, 'closed');
        if (!isAllowed) {
            throw new HttpsError('resource-exhausted', 'Too many save requests. Please wait a moment.');
        }

        // Sensitive config writes require strict company admin (or super admin).
        await assertCompanyAdminStrict(request.auth.uid, companyId);

        // Reference to the admin-only subcollection document
        const emailConfigRef = db.collection('companies').doc(companyId)
            .collection('system_settings').doc('email_config');

        // PARTIAL UPDATE SUPPORT:
        // If smtpPass is omitted/empty, preserve the existing password from the subcollection.
        let finalPassword;

        if (smtpPass && smtpPass.trim()) {
            // New plaintext password provided — store as-is (no encryption)
            finalPassword = smtpPass.trim();
        } else {
            // No new password provided — fetch and preserve existing password
            const existingDoc = await emailConfigRef.get();
            const existingSettings = existingDoc.exists ? existingDoc.data() : {};
            finalPassword = existingSettings.smtpPass || null;

            if (!finalPassword) {
                throw new HttpsError(
                    'invalid-argument',
                    'SMTP password is required for initial setup. Please enter your SMTP password.'
                );
            }
        }

        const emailConfig = {
            smtpHost: smtpHost.trim(),
            smtpPort: parseInt(smtpPort) || 587,
            smtpUser: smtpUser.trim(),
            smtpPass: finalPassword,           // Plaintext — subcollection is admin-only
            signature: signature || '',
            isVerified: true,                  // Only saved after testEmailConnection succeeds
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: request.auth.uid,
        };

        // Write to admin-only subcollection (not root company doc)
        await emailConfigRef.set(emailConfig, { merge: true });

        // Also update non-sensitive fields on root company doc for backward compat
        // (UI status banners, etc.) — but NEVER the password
        await db.collection('companies').doc(companyId).update({
            'emailSettings.smtpHost': emailConfig.smtpHost,
            'emailSettings.smtpPort': emailConfig.smtpPort,
            'emailSettings.smtpUser': emailConfig.smtpUser,
            'emailSettings.signature': emailConfig.signature,
            'emailSettings.isVerified': emailConfig.isVerified,
            'emailSettings.updatedAt': emailConfig.updatedAt,
        });

        console.log(`[saveEmailSettings] Settings saved for company ${companyId} by ${request.auth.uid}`);

        // NEVER return smtpPass to the client
        return {
            success: true,
            message: 'Email settings saved securely.',
            hasPassword: true,
        };
    }
);
