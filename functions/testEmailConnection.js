const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { testEmailCredentials } = require('./emailService');
const { checkRateLimit } = require('./shared/rateLimiter');

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

    // CONN-3 FIX: Rate limit to 5 test attempts per user per minute.
    // Without this, an attacker could use this endpoint to brute-force SMTP credentials
    // against external mail servers, making SafeHaul an SMTP credential spraying proxy.
    const isAllowed = await checkRateLimit(`test_email_${request.auth.uid}`, 5, 60, 'closed');
    if (!isAllowed) {
        throw new HttpsError('resource-exhausted', 'Too many connection tests. Please wait a moment before trying again.');
    }

    const { smtpHost, smtpPort, smtpUser, smtpPass } = request.data;

    // Validate required fields
    if (!smtpHost || !smtpUser || !smtpPass) {
        throw new HttpsError(
            'invalid-argument',
            'Missing required fields. Please provide smtpHost, smtpUser, and smtpPass.'
        );
    }

    // DOUBLE-ENCRYPTION GUARD: Reject passwords that look like stored ciphertext.
    // Strategy A: testEmailConnection only accepts plaintext credentials.
    // If the frontend accidentally sends an encrypted value, we catch it here
    // instead of silently failing during SMTP auth.
    if (smtpPass.startsWith('enc:v1:')) {
        throw new HttpsError(
            'invalid-argument',
            'Invalid password format. Please enter your actual SMTP password to test the connection.'
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
