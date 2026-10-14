const nodemailer = require('nodemailer');
const { readSmtpSettings, smtpTransportOptions, smtpFingerprint } = require('./shared/smtpSettings');

/**
 * Dynamic Email Service for SafeHaul
 * Sends emails using company-specific SMTP credentials stored in Firestore
 */

// --- Transporter cache: one pooled connection per company, while its settings stay the same ---
const transporterCache = new Map();

function getCachedTransporter(companyId, settings) {
    const fingerprint = smtpFingerprint(settings);
    const cached = transporterCache.get(companyId);
    if (cached && cached.fingerprint === fingerprint) return cached.transporter;

    // The settings changed: the old connection's server, account or password is no longer the company's.
    if (cached) cached.transporter.close();
    const transporter = nodemailer.createTransport({
        ...smtpTransportOptions(settings),
        pool: true,         // use connection pooling
        maxConnections: 3,
        maxMessages: 50,
    });
    transporterCache.set(companyId, { transporter, fingerprint });
    return transporter;
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
        const { settings: emailSettings, companyName } = await readSmtpSettings(companyId);

        // Validate SMTP settings exist (a password is in every settings the reader returns)
        if (!emailSettings || !emailSettings.user) {
            throw new Error(
                `Missing email configuration for company ${companyId}. ` +
                `Please configure SMTP settings in Company Settings > Email tab. ` +
                `Required fields: smtpHost, smtpPort, smtpUser, smtpPass`
            );
        }

        // Reuse the company's pooled Nodemailer transporter while its settings stay the same
        const transporter = getCachedTransporter(companyId, emailSettings);

        // Prepare email options
        const mailOptions = {
            from: `"${companyName}" <${emailSettings.user}>`,
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
            from: emailSettings.user,
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
        const { settings: emailSettings } = await readSmtpSettings(companyId);

        if (!emailSettings || !emailSettings.user) {
            return {
                success: false,
                error: 'Missing SMTP configuration. Please provide host, port, user, and password.',
            };
        }

        // Create transporter
        const transporter = nodemailer.createTransport(smtpTransportOptions(emailSettings));

        // Verify connection
        await transporter.verify();

        console.log(`[testEmailConnection] SMTP connection successful for company ${companyId}`);
        return {
            success: true,
            message: 'SMTP connection verified successfully!',
            host: emailSettings.host,
            user: emailSettings.user,
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
    sendDynamicEmail,
    testEmailConnection,
    testEmailCredentials,
};
