const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("./firebaseAdmin");
const { checkRateLimit } = require("./shared/rateLimiter");
const { assertCompanyAdminStrict } = require("./shared/companyAccess");
const { testEmailCredentials } = require("./emailService");
const { isSealed, normalizeSmtpSettings, sealPassword } = require("./shared/smtpSettings");

/**
 * Saves a company's email settings to `companies/{companyId}/system_settings/
 * email_config`, which only the server reads or writes (Firestore rules).
 *
 * The password is stored encrypted (`enc:v1:`, `sealPassword`); every reader
 * opens it through `shared/smtpSettings.js`, and the vault shows it decrypted.
 * A value that is already encrypted is refused, so ciphertext sent back can
 * never be encrypted twice. A blank password keeps the stored one, encrypting
 * it if an older save left it in plain text. The copy older saves left on the
 * company document, which the whole team reads, is removed.
 *
 * The SMTP password is NEVER returned to the frontend.
 *
 * `isVerified` ("Successfully Linked" on the settings screen) is set from a
 * connection the server opens with the values it saves, on every save: Save
 * Settings runs no Test Connection first.
 */
exports.saveEmailSettings = onCall(
    // The secret encrypts the password, and decrypts a stored one for that check.
    { cors: true, secrets: ['SMS_ENCRYPTION_KEY'] },
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

        // The server-only email_config document
        const emailConfigRef = db.collection('companies').doc(companyId)
            .collection('system_settings').doc('email_config');

        // PARTIAL UPDATE SUPPORT:
        // If smtpPass is omitted/empty, preserve the existing password from the subcollection.
        let finalPassword;

        if (isSealed(smtpPass)) {
            throw new HttpsError('invalid-argument', 'Enter the SMTP password itself.');
        }
        if (smtpPass && smtpPass.trim()) {
            finalPassword = sealPassword(smtpPass.trim());
        } else {
            // No new password provided — fetch and preserve existing password
            const existingDoc = await emailConfigRef.get();
            const existingSettings = existingDoc.exists ? existingDoc.data() : {};
            const stored = existingSettings.smtpPass || null;

            if (!stored) {
                throw new HttpsError(
                    'invalid-argument',
                    'SMTP password is required for initial setup. Please enter your SMTP password.'
                );
            }
            finalPassword = isSealed(stored) ? stored : sealPassword(stored);
        }

        // The settings are saved either way; only a connection that opens marks them verified.
        let check;
        try {
            check = await testEmailCredentials({
                smtpHost: smtpHost.trim(),
                smtpPort,
                smtpUser: smtpUser.trim(),
                smtpPass: normalizeSmtpSettings({ smtpPass: finalPassword }).pass,
            });
        } catch (err) {
            check = { success: false, error: err.message };
        }

        const emailConfig = {
            smtpHost: smtpHost.trim(),
            smtpPort: parseInt(smtpPort) || 587,
            smtpUser: smtpUser.trim(),
            smtpPass: finalPassword,           // Encrypted
            signature: signature || '',
            isVerified: check.success === true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: request.auth.uid,
        };

        await emailConfigRef.set(emailConfig, { merge: true });

        // Also update non-sensitive fields on root company doc for backward compat
        // (UI status banners, etc.) — never the password, and drop one an older save left there
        await db.collection('companies').doc(companyId).update({
            'emailSettings.smtpHost': emailConfig.smtpHost,
            'emailSettings.smtpPort': emailConfig.smtpPort,
            'emailSettings.smtpUser': emailConfig.smtpUser,
            'emailSettings.signature': emailConfig.signature,
            'emailSettings.isVerified': emailConfig.isVerified,
            'emailSettings.updatedAt': emailConfig.updatedAt,
            'emailSettings.smtpPass': admin.firestore.FieldValue.delete(),
        });

        console.log(`[saveEmailSettings] Settings saved for company ${companyId} by ${request.auth.uid}`);

        // NEVER return smtpPass to the client
        return {
            success: true,
            verified: emailConfig.isVerified,
            ...(emailConfig.isVerified ? {} : { verificationError: check.error || 'The connection could not be verified.' }),
            message: emailConfig.isVerified
                ? 'Email settings saved securely.'
                : 'Email settings saved, but the connection could not be verified.',
            hasPassword: true,
        };
    }
);
