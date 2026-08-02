const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("./firebaseAdmin");
const { assertCompanyAdminStrict } = require("./shared/companyAccess");

/**
 * Get sanitized email settings metadata for the UI.
 *
 * Returns all non-sensitive email configuration fields so the frontend
 * can render the settings form without ever receiving the SMTP password.
 *
 * This replaces direct Firestore reads of the company root document
 * which previously exposed smtpPass (encrypted or plaintext) to the client.
 */
exports.getEmailSettingsMeta = onCall(
    { cors: true },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Login required.');
        }

        const { companyId } = request.data || {};

        if (!companyId) {
            throw new HttpsError('invalid-argument', 'Missing required field: companyId.');
        }

        // Metadata includes sensitive integration details; require admin access.
        await assertCompanyAdminStrict(request.auth.uid, companyId);

        // PRIMARY: Read from admin-only subcollection
        const emailConfigRef = db.collection('companies').doc(companyId)
            .collection('system_settings').doc('email_config');
        const configDoc = await emailConfigRef.get();

        if (configDoc.exists) {
            const data = configDoc.data();
            return {
                success: true,
                settings: {
                    smtpHost: data.smtpHost || '',
                    smtpPort: data.smtpPort || 587,
                    smtpUser: data.smtpUser || '',
                    signature: data.signature || '',
                    isVerified: data.isVerified || false,
                    updatedAt: data.updatedAt || null,
                    hasPassword: !!data.smtpPass,
                    // NEVER include smtpPass
                },
            };
        }

        // LEGACY FALLBACK: Read non-sensitive fields from root company doc
        const companyDoc = await db.collection('companies').doc(companyId).get();
        if (companyDoc.exists) {
            const companyData = companyDoc.data();
            const legacy = companyData.emailSettings || {};
            return {
                success: true,
                settings: {
                    smtpHost: legacy.smtpHost || '',
                    smtpPort: legacy.smtpPort || 587,
                    smtpUser: legacy.smtpUser || '',
                    signature: legacy.signature || '',
                    isVerified: legacy.isVerified || false,
                    updatedAt: legacy.updatedAt || null,
                    hasPassword: !!legacy.smtpPass,
                    // NEVER include smtpPass
                },
            };
        }

        // No settings configured yet
        return {
            success: true,
            settings: {
                smtpHost: '',
                smtpPort: 587,
                smtpUser: '',
                signature: '',
                isVerified: false,
                updatedAt: null,
                hasPassword: false,
            },
        };
    }
);
