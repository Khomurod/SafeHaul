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
 *
 * `signatureOnly: true` saves the signature alone, with no SMTP fields and no
 * connection check: the Email tab sends it while Gmail is connected. A full
 * SMTP save is refused while Gmail is connected (`provider === 'gmail'`,
 * `gmailConnection.js`); the stored SMTP settings are kept for a disconnect.
 */
const GMAIL_CONNECTED = 'Gmail is connected. Disconnect Gmail in Settings → Email to send through your mail server again.';

const SIGNATURE_WITH_SERVER = 'Save the signature together with your mail server settings.';

/**
 * The signature alone, on `email_config`, its copy on the company document,
 * and the oldest settings (`integrations/email_settings`) where they remain, so
 * the mail server sends it too once Gmail is disconnected. Only while Gmail is
 * connected: a company on its mail server may still send with older settings
 * kept elsewhere, which a signature-only document would hide from the Email tab.
 */
async function saveSignature(uid, companyId, emailConfigRef, signature) {
    const existing = await emailConfigRef.get();
    if (!existing.exists || existing.data()?.provider !== 'gmail') {
        throw new HttpsError('failed-precondition', SIGNATURE_WITH_SERVER);
    }
    const companyRef = db.collection('companies').doc(companyId);
    const updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await emailConfigRef.set({ signature, updatedAt, updatedBy: uid }, { merge: true });
    await companyRef.update({ 'emailSettings.signature': signature });
    const oldest = companyRef.collection('integrations').doc('email_settings');
    if ((await oldest.get()).exists) await oldest.set({ signature }, { merge: true });
    console.log(`[saveEmailSettings] Signature saved for company ${companyId} by ${uid}`);
    return { success: true, message: 'Signature saved.' };
}

exports.saveEmailSettings = onCall(
    // The secret encrypts the password, and decrypts a stored one for that check.
    { cors: true, secrets: ['SMS_ENCRYPTION_KEY'] },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Login required.');
        }

        const { companyId, smtpHost, smtpPort, smtpUser, smtpPass, signature, signatureOnly } = request.data || {};
        const onlySignature = signatureOnly === true;

        if (!companyId || (!onlySignature && (!smtpHost || !smtpUser))) {
            throw new HttpsError('invalid-argument', onlySignature
                ? 'Missing required field: companyId.'
                : 'Missing required fields: companyId, smtpHost, smtpUser.');
        }
        if (onlySignature && signature !== undefined && signature !== null && typeof signature !== 'string') {
            throw new HttpsError('invalid-argument', 'The signature must be text.');
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

        if (onlySignature) return saveSignature(request.auth.uid, companyId, emailConfigRef, signature || '');

        if (isSealed(smtpPass)) {
            throw new HttpsError('invalid-argument', 'Enter the SMTP password itself.');
        }
        const existingDoc = await emailConfigRef.get();
        const existingSettings = existingDoc.exists ? existingDoc.data() || {} : {};
        if (existingSettings.provider === 'gmail') {
            throw new HttpsError('failed-precondition', GMAIL_CONNECTED);
        }

        // PARTIAL UPDATE SUPPORT:
        // If smtpPass is omitted/empty, preserve the existing password from the subcollection.
        let finalPassword;

        if (smtpPass && smtpPass.trim()) {
            finalPassword = sealPassword(smtpPass.trim());
        } else {
            // No new password provided — preserve the existing password
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
