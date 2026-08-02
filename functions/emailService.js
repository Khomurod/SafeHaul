const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { decrypt } = require('./integrations/encryption');

/**
 * Dynamic Email Service for SafeHaul
 * Sends emails using company-specific SMTP credentials stored in Firestore
 */

// --- Transporter cache (keyed by companyId, expires after 10 minutes) ---
const transporterCache = new Map();
const TRANSPORTER_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCachedTransporter(companyId, smtpConfig) {
    const cacheKey = companyId;
    const cached = transporterCache.get(cacheKey);

    if (cached && (Date.now() - cached.createdAt) < TRANSPORTER_TTL_MS) {
        return cached.transporter;
    }

    const transporter = nodemailer.createTransport({
        host: smtpConfig.smtpHost,
        port: smtpConfig.smtpPort || 587,
        secure: smtpConfig.smtpPort === 465,
        auth: {
            user: smtpConfig.smtpUser,
            // CONN-1 FIX: Decrypt password (supports both encrypted and legacy plain-text)
            pass: decryptSmtpPassword(smtpConfig.smtpPass),
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 30000,
        pool: true,         // use connection pooling
        maxConnections: 3,
        maxMessages: 50,
    });

    transporterCache.set(cacheKey, { transporter, createdAt: Date.now() });
    return transporter;
}

/**
 * Shared helper: Fetch email settings for a company.
 * REFACTOR: Prefers admin-only subcollection 'system_settings/email_config' (new).
 * Falls back to legacy root 'emailSettings' field for pre-migration companies.
 * @param {string} companyId
 * @returns {Promise<{settings: object, companyName: string}>}
 */
async function getEmailSettings(companyId) {
    const db = admin.firestore();
    const companyDoc = await db.collection('companies').doc(companyId).get();

    if (!companyDoc.exists) {
        throw new Error(`Company not found: ${companyId}`);
    }

    const companyData = companyDoc.data();

    // PRIMARY: Read from admin-only subcollection (new location)
    const settingsDoc = await db.collection('companies').doc(companyId)
        .collection('system_settings').doc('email_config').get();

    if (settingsDoc.exists && settingsDoc.data().smtpPass) {
        return { settings: settingsDoc.data(), companyName: companyData.companyName || 'SafeHaul' };
    }

    // LEGACY FALLBACK: Read from root emailSettings (pre-migration companies)
    // This path handles both encrypted (enc:v1:) and legacy plaintext passwords.
    const legacySettings = companyData.emailSettings;
    if (legacySettings) {
        return { settings: legacySettings, companyName: companyData.companyName || 'SafeHaul' };
    }

    return { settings: null, companyName: companyData.companyName || 'SafeHaul' };
}

/**
 * CONN-1 FIX: Decrypt SMTP password if it was stored with the `enc:v1:` versioned prefix.
 * Passwords saved by the new saveEmailSettings Cloud Function are encrypted.
 * Legacy plain-text passwords (no prefix) are returned as-is for backwards compatibility.
 * CONN-12 FIX: Use versioned prefix check instead of fragile `includes(':')` heuristic.
 * @param {string} rawPass - The raw password value from Firestore
 * @returns {string} - The decrypted (or plain-text legacy) password
 */
function decryptSmtpPassword(rawPass) {
    if (!rawPass) return rawPass;
    // Versioned prefix ensures we only attempt decryption on known-encrypted values.
    // A plain-text password containing ':' will never match 'enc:v1:' — no false positives.
    if (rawPass.startsWith('enc:v1:')) {
        try {
            return decrypt(rawPass.slice('enc:v1:'.length));
        } catch (err) {
            console.error('[emailService] Failed to decrypt SMTP password:', err.message);
            throw new Error('Email configuration error: could not decrypt SMTP credentials.');
        }
    }
    return rawPass; // Legacy plain-text password — accepted until migrated
}

/**
 * Send email using company's own SMTP credentials
 * @param {string} companyId - Firestore company document ID
 * @param {string|string[]} to - Recipient email address(es)
 * @param {string} subject - Email subject line
 * @param {string} html - HTML email body
 * @param {object} options - Additional options (cc, bcc, attachments)
 * @returns {Promise<object>} - Send result with messageId or error
 */
async function sendDynamicEmail(companyId, to, subject, html, options = {}) {
    try {
        const { settings: emailSettings, companyName } = await getEmailSettings(companyId);

        // Validate SMTP settings exist
        if (!emailSettings || !emailSettings.smtpHost || !emailSettings.smtpUser || !emailSettings.smtpPass) {
            throw new Error(
                `Missing email configuration for company ${companyId}. ` +
                `Please configure SMTP settings in Company Settings > Email tab. ` +
                `Required fields: smtpHost, smtpPort, smtpUser, smtpPass`
            );
        }

        // Reuse cached Nodemailer transporter (pooled, per-company, 10-min TTL)
        const transporter = getCachedTransporter(companyId, emailSettings);

        // Prepare email options
        const mailOptions = {
            from: `"${companyName}" <${emailSettings.smtpUser}>`,
            to: Array.isArray(to) ? to.join(', ') : to,
            subject: subject,
            html: html,
            ...options, // Allow cc, bcc, attachments, etc.
        };

        // Add signature if configured
        if (emailSettings.signature) {
            mailOptions.html += `<br><br><div style="white-space: pre-line;">${emailSettings.signature}</div>`;
        }

        // Send email
        console.log(`[sendDynamicEmail] Sending email from ${companyId} to ${to}`);
        const info = await transporter.sendMail(mailOptions);

        console.log(`[sendDynamicEmail] Email sent successfully. MessageID: ${info.messageId}`);
        return {
            success: true,
            messageId: info.messageId,
            from: emailSettings.smtpUser,
        };

    } catch (error) {
        console.error(`[sendDynamicEmail] Error sending email:`, error);
        throw new Error(`Failed to send email: ${error.message}`);
    }
}

/**
 * Test email connection without sending a message
 * @param {string} companyId - Firestore company document ID
 * @returns {Promise<object>} - Connection test result
 */
async function testEmailConnection(companyId) {
    try {
        const { settings: emailSettings } = await getEmailSettings(companyId);

        if (!emailSettings || !emailSettings.smtpHost || !emailSettings.smtpUser || !emailSettings.smtpPass) {
            return {
                success: false,
                error: 'Missing SMTP configuration. Please provide host, port, user, and password.',
            };
        }

        // Create transporter
        const transporter = nodemailer.createTransport({
            host: emailSettings.smtpHost,
            port: emailSettings.smtpPort || 587,
            secure: emailSettings.smtpPort === 465,
            auth: {
                user: emailSettings.smtpUser,
                pass: decryptSmtpPassword(emailSettings.smtpPass),
            },
            connectionTimeout: 10000,
        });

        // Verify connection
        await transporter.verify();

        console.log(`[testEmailConnection] SMTP connection successful for company ${companyId}`);
        return {
            success: true,
            message: 'SMTP connection verified successfully!',
            host: emailSettings.smtpHost,
            user: emailSettings.smtpUser,
        };

    } catch (error) {
        console.error(`[testEmailConnection] Connection test failed:`, error);
        return {
            success: false,
            error: error.message || 'Connection test failed',
            details: error.code,
        };
    }
}

/**
 * Test email connection with provided credentials (before saving)
 * @param {object} smtpConfig - SMTP configuration object
 * @returns {Promise<object>} - Test result
 */
async function testEmailCredentials(smtpConfig) {
    try {
        const { smtpHost, smtpPort, smtpUser, smtpPass } = smtpConfig;

        if (!smtpHost || !smtpUser || !smtpPass) {
            return {
                success: false,
                error: 'Missing required SMTP fields',
            };
        }

        // CONN-2 FIX: SSRF protection — reject private/loopback/link-local hostnames.
        // Without this, an attacker (or misconfigured admin) could use the test endpoint to probe
        // internal GCP metadata servers (169.254.169.254), localhost services, or internal VPC hosts.
        // NOTE: This check validates the literal hostname/IP string. DNS rebinding attacks
        // (where a domain initially resolves to a legitimate IP but re-resolves to a blocked IP)
        // are not fully mitigated here. For full protection, add a post-DNS-resolution IP check
        // using Node's dns.lookup() before opening the connection. The connectionTimeout: 10000
        // below provides a partial defense by failing fast on unexpected hosts.
        const SSRF_BLOCKLIST = [
            /^127\./,                          // IPv4 loopback
            /^10\./,                           // RFC-1918 private
            /^192\.168\./,                     // RFC-1918 private
            /^172\.(1[6-9]|2\d|3[01])\./,    // RFC-1918 private
            /^169\.254\./,                     // Link-local (GCP metadata)
            /^::1$/,                           // IPv6 loopback
            /^fc00:/i,                         // IPv6 unique local
            /^fe80:/i,                         // IPv6 link-local
            /^0\./,                            // Reserved
        ];
        const hostLower = smtpHost.toLowerCase().trim();
        // Block obvious localhost variants
        if (hostLower === 'localhost' || hostLower === '0.0.0.0') {
            return { success: false, error: 'Invalid SMTP host.' };
        }
        for (const pattern of SSRF_BLOCKLIST) {
            if (pattern.test(smtpHost)) {
                return { success: false, error: 'Invalid SMTP host: internal addresses are not allowed.' };
            }
        }

        // Validate port is in the allowed SMTP range
        const port = parseInt(smtpPort) || 587;
        const ALLOWED_PORTS = [25, 465, 587, 2525];
        if (!ALLOWED_PORTS.includes(port)) {
            return { success: false, error: `Invalid SMTP port. Allowed ports: ${ALLOWED_PORTS.join(', ')}.` };
        }

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: port,
            secure: port === 465,
            auth: {
                user: smtpUser,
                pass: smtpPass,
            },
            connectionTimeout: 10000,
        });

        await transporter.verify();

        return {
            success: true,
            message: 'Connection verified! You can save these settings.',
        };

    } catch (error) {
        console.error('[testEmailCredentials] Test failed:', error);

        // Provide user-friendly error messages
        let friendlyError = error.message;
        if (error.code === 'EAUTH') {
            friendlyError = 'Authentication failed. Please check your email and password.';
        } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNECTION') {
            friendlyError = 'Connection timeout. Please check the host and port.';
        }

        return {
            success: false,
            error: friendlyError,
            code: error.code,
        };
    }
}

module.exports = {
    getEmailSettings,
    sendDynamicEmail,
    testEmailConnection,
    testEmailCredentials,
};
