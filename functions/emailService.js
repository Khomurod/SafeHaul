const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

/**
 * Dynamic Email Service for SafeHaul
 * Sends emails using company-specific SMTP credentials stored in Firestore
 */

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
        // Fetch company document to get SMTP settings
        const db = admin.firestore();
        const companyDoc = await db.collection('companies').doc(companyId).get();

        if (!companyDoc.exists) {
            throw new Error(`Company not found: ${companyId}`);
        }

        const companyData = companyDoc.data();
        const emailSettings = companyData.emailSettings;

        // Validate SMTP settings exist
        if (!emailSettings || !emailSettings.smtpHost || !emailSettings.smtpUser || !emailSettings.smtpPass) {
            throw new Error(
                `Missing email configuration for company ${companyId}. ` +
                `Please configure SMTP settings in Company Settings > Email tab. ` +
                `Required fields: smtpHost, smtpPort, smtpUser, smtpPass`
            );
        }

        // Create Nodemailer transporter with company's SMTP credentials
        const transporter = nodemailer.createTransport({
            host: emailSettings.smtpHost,
            port: emailSettings.smtpPort || 587,
            secure: emailSettings.smtpPort === 465, // true for 465, false for other ports
            auth: {
                user: emailSettings.smtpUser,
                pass: emailSettings.smtpPass,
            },
            // Timeout settings
            connectionTimeout: 10000, // 10 seconds
            greetingTimeout: 10000,
            socketTimeout: 30000, // 30 seconds
        });

        // Prepare email options
        const mailOptions = {
            from: `"${companyData.companyName || 'SafeHaul'}" <${emailSettings.smtpUser}>`,
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
        const db = admin.firestore();
        const companyDoc = await db.collection('companies').doc(companyId).get();

        if (!companyDoc.exists) {
            return {
                success: false,
                error: `Company not found: ${companyId}`,
            };
        }

        const emailSettings = companyDoc.data().emailSettings;

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
                pass: emailSettings.smtpPass,
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

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort || 587,
            secure: smtpPort === 465,
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
