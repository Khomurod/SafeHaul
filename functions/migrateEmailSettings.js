const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("./firebaseAdmin");
const { decrypt } = require("./integrations/encryption");
const { sealPassword } = require("./shared/smtpSettings");

/**
 * One-time migration: Move email settings from root company doc to the server-only email_config document.
 *
 * For each company:
 *  1. If system_settings/email_config already exists with smtpPass → SKIP (idempotent)
 *  2. If root emailSettings exists:
 *     a. If smtpPass is enc:v1:... → check it decrypts, store it as it is in the subcollection
 *     b. If smtpPass is plaintext → store it encrypted (shared/smtpSettings.js)
 *     c. Remove smtpPass from root emailSettings (keep non-sensitive fields)
 *  3. If no emailSettings → SKIP
 *
 * Requires super_admin authentication.
 * Safe to re-run — will not duplicate or corrupt data.
 */
exports.migrateEmailSettings = onCall(
    { cors: true, secrets: ['SMS_ENCRYPTION_KEY'], timeoutSeconds: 300 },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Login required.');
        }

        // Super admin only — check both claim locations (matches Firestore rules + DataContext)
        const userRecord = await admin.auth().getUser(request.auth.uid);
        const claims = userRecord.customClaims || {};
        const roles = claims.roles || {};
        const isSuperAdmin = claims.globalRole === 'super_admin' || roles.globalRole === 'super_admin';

        if (!isSuperAdmin) {
            throw new HttpsError('permission-denied', 'Only super admins can run migrations.');
        }

        console.log('[migrateEmailSettings] Starting migration...');

        const companiesSnap = await db.collection('companies').get();
        const results = { migrated: 0, skipped: 0, errors: 0, noSettings: 0, details: [] };

        for (const companyDoc of companiesSnap.docs) {
            const companyId = companyDoc.id;
            const companyData = companyDoc.data();

            try {
                // Check if already migrated
                const emailConfigRef = db.collection('companies').doc(companyId)
                    .collection('system_settings').doc('email_config');
                const existingConfig = await emailConfigRef.get();

                if (existingConfig.exists && existingConfig.data().smtpPass) {
                    results.skipped++;
                    results.details.push({ companyId, status: 'skipped', reason: 'already_migrated' });
                    continue;
                }

                // Check if root emailSettings exists
                const legacySettings = companyData.emailSettings;
                if (!legacySettings || !legacySettings.smtpPass) {
                    results.noSettings++;
                    results.details.push({ companyId, status: 'skipped', reason: 'no_email_settings' });
                    continue;
                }

                // Stored encrypted, as saveEmailSettings stores it; a plain one is encrypted.
                let storedPassword;
                const storedPass = legacySettings.smtpPass;

                if (storedPass.startsWith('enc:v1:')) {
                    try {
                        decrypt(storedPass.slice('enc:v1:'.length));
                        storedPassword = storedPass;
                    } catch (decryptErr) {
                        // Double-encrypted or corrupted — flag for manual intervention
                        console.error(`[migrateEmailSettings] DECRYPT FAILED for ${companyId}:`, decryptErr.message);
                        results.errors++;
                        results.details.push({
                            companyId,
                            status: 'error',
                            reason: 'decrypt_failed',
                            error: decryptErr.message,
                        });
                        continue;
                    }
                } else {
                    storedPassword = sealPassword(storedPass);
                }

                // Write the server-only email_config document
                await emailConfigRef.set({
                    smtpHost: legacySettings.smtpHost || '',
                    smtpPort: legacySettings.smtpPort || 587,
                    smtpUser: legacySettings.smtpUser || '',
                    smtpPass: storedPassword,
                    signature: legacySettings.signature || '',
                    isVerified: legacySettings.isVerified || false,
                    updatedAt: legacySettings.updatedAt || admin.firestore.FieldValue.serverTimestamp(),
                    migratedAt: admin.firestore.FieldValue.serverTimestamp(),
                    migratedFrom: 'root_emailSettings',
                });

                // Remove smtpPass from root (keep non-sensitive fields for backward compat)
                await db.collection('companies').doc(companyId).update({
                    'emailSettings.smtpPass': admin.firestore.FieldValue.delete(),
                });

                results.migrated++;
                results.details.push({ companyId, status: 'migrated', encrypted: storedPass.startsWith('enc:v1:') });
                console.log(`[migrateEmailSettings] ✅ Migrated company ${companyId}`);

            } catch (err) {
                console.error(`[migrateEmailSettings] Error processing ${companyId}:`, err.message);
                results.errors++;
                results.details.push({ companyId, status: 'error', error: err.message });
            }
        }

        console.log(`[migrateEmailSettings] Migration complete:`, {
            migrated: results.migrated,
            skipped: results.skipped,
            noSettings: results.noSettings,
            errors: results.errors,
        });

        return {
            success: true,
            summary: {
                total: companiesSnap.size,
                migrated: results.migrated,
                skipped: results.skipped,
                noSettings: results.noSettings,
                errors: results.errors,
            },
            details: results.details,
        };
    }
);
