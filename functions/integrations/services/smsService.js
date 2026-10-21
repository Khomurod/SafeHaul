const { onCall, HttpsError } = require('firebase-functions/v2/https');
const SMSAdapterFactory = require('../factory');
const { assertCompanyAdminStrict } = require('../../shared/companyAccess');
const { checkRateLimit } = require('../../shared/rateLimiter');

// Shared options for functions that need encryption capabilities
const encryptedCallOptions = {
    cors: true,
    secrets: ['SMS_ENCRYPTION_KEY']
};

/**
 * 2. Test Connection / Diagnostic Lab
 */
exports.sendTestSMS = onCall(encryptedCallOptions, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

    // Add 'fromNumber' to destructured props for diagnostic testing
    const { companyId, testPhoneNumber, fromNumber } = request.data;

    try {
        await assertCompanyAdminStrict(request.auth.uid, companyId);
        const rateOk = await checkRateLimit(`send_test_sms_${companyId}_${request.auth.uid}`, 20, 300, 'closed');
        if (!rateOk) {
            throw new HttpsError('resource-exhausted', 'Too many test SMS requests. Please try again shortly.');
        }

        // NEW: Use per-line JWT routing if a specific fromNumber is provided
        // This gets an adapter authenticated with that line's specific JWT from the keychain
        const adapter = fromNumber
            ? await SMSAdapterFactory.getAdapterForNumber(companyId, fromNumber)
            : await SMSAdapterFactory.getAdapter(companyId);

        // Pass 'fromNumber' as the 4th argument (explicit override for testing)
        // Pass request.auth.uid as 3rd arg (userId context)
        const result = await adapter.sendSMS(
            testPhoneNumber,
            "SafeHaul Diagnostic Test: This message confirms your line is active.",
            request.auth.uid,
            fromNumber || null
        );

        console.log("[sendTestSMS] Adapter result:", JSON.stringify(result));

        return {
            success: true,
            message: "Test message sent successfully.",
            sentFrom: fromNumber || 'default',
            adapterResponse: result
        };

    } catch (error) {
        console.error("Test SMS Error:", error);
        // Return the specific error message from the adapter to help debugging
        throw new HttpsError('internal', error.message);
    }
});
