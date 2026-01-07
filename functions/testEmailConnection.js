const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { testEmailCredentials } = require('./emailService');

/**
 * Test Email Connection (Cloud Function)
 * Allows users to test SMTP credentials before saving them
 */
exports.testEmailConnection = onCall({
    cors: true,
    maxInstances: 10
}, async (request) => {
    // Require authentication
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in to test email connection.');
    }

    const { smtpHost, smtpPort, smtpUser, smtpPass } = request.data;

    // Validate required fields
    if (!smtpHost || !smtpUser || !smtpPass) {
        throw new HttpsError(
            'invalid-argument',
            'Missing required fields. Please provide smtpHost, smtpUser, and smtpPass.'
        );
    }

    console.log(`[testEmailConnection] Testing connection for user: ${smtpUser}`);

    try {
        // Call the email service test function
        const result = await testEmailCredentials({
            smtpHost,
            smtpPort: parseInt(smtpPort) || 587,
            smtpUser,
            smtpPass,
        });

        if (result.success) {
            console.log(`[testEmailConnection] ✅ Connection successful for ${smtpUser}`);
            return {
                success: true,
                message: result.message || 'Connection verified successfully!',
            };
        } else {
            console.warn(`[testEmailConnection] ❌ Connection failed: ${result.error}`);
            return {
                success: false,
                error: result.error,
                code: result.code,
            };
        }
    } catch (error) {
        console.error('[testEmailConnection] Unexpected error:', error);
        throw new HttpsError('internal', `Test failed: ${error.message}`);
    }
});
