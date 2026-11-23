const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("./firebaseAdmin");
const { assertCompanyAdminStrict } = require("./shared/companyAccess");
const { millisOf } = require("./shared/millisOf");
const { nameFromProfile } = require("./shared/userIdentity");

/** `settings.gmail` while no Gmail is connected (`gmailConnection.js`). */
const GMAIL_NOT_CONNECTED = Object.freeze({
    connected: false,
    email: null,
    status: null,
    statusReason: null,
    connectedAt: null,
    connectedByName: null,
});

/**
 * The company's Gmail connection, as the Email tab shows it: the account, its
 * status, when (milliseconds) and by whom it was connected. Never the token.
 */
async function gmailMeta(data) {
    if (data.provider !== 'gmail' || !data.gmailRefreshToken) return { ...GMAIL_NOT_CONNECTED };
    let connectedByName = null;
    if (typeof data.gmailConnectedBy === 'string' && data.gmailConnectedBy && !data.gmailConnectedBy.includes('/')) {
        try {
            const user = await db.collection('users').doc(data.gmailConnectedBy).get();
            connectedByName = user.exists ? nameFromProfile(user.data()) : null;
        } catch (error) {
            console.warn('[getEmailSettingsMeta] The user who connected Gmail could not be read:', error?.code ?? 'error');
        }
    }
    return {
        connected: true,
        email: data.gmailEmail || null,
        status: data.gmailStatus || 'active',
        statusReason: data.gmailStatusReason || null,
        connectedAt: millisOf(data.gmailConnectedAt),
        connectedByName,
    };
}

/**
 * Get sanitized email settings metadata for the UI.
 *
 * Returns all non-sensitive email configuration fields so the frontend
 * can render the settings form without ever receiving the SMTP password,
 * and `settings.gmail`, the company's Gmail connection without its token.
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

        // PRIMARY: Read from the server-only email_config document
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
                    // NEVER include smtpPass, or gmailRefreshToken
                    gmail: await gmailMeta(data),
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
                    gmail: { ...GMAIL_NOT_CONNECTED },
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
                gmail: { ...GMAIL_NOT_CONNECTED },
            },
        };
    }
);
