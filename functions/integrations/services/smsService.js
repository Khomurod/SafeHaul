const { onCall, HttpsError } = require('firebase-functions/v2/https');
const SMSAdapterFactory = require('../factory');
const { assertCompanyAdminStrict } = require('../../shared/companyAccess');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { createAndStartBulkSession } = require('../../bulkActions/helpers/sessionFactory');

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

/**
 * 2.1 Send Real SMS (Outbound)
 */
exports.sendSMS = onCall(encryptedCallOptions, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

    const { companyId, recipientPhone, messageBody } = request.data;
    const userId = request.auth.uid;

    if (!recipientPhone || !messageBody) {
        throw new HttpsError('invalid-argument', 'Missing recipientPhone or messageBody.');
    }

    try {
        await assertCompanyAdminStrict(userId, companyId);
        const rateOk = await checkRateLimit(`send_sms_${companyId}_${userId}`, 120, 300, 'closed');
        if (!rateOk) {
            throw new HttpsError('resource-exhausted', 'Rate limit exceeded. Please wait before sending more messages.');
        }

        // Use the smart recruiter routing - automatically picks dedicated credentials if assigned
        const adapter = await SMSAdapterFactory.getAdapterForUser(companyId, userId);

        // Use the adapter's intelligent routing (userId -> assigned number)
        await adapter.sendSMS(
            recipientPhone,
            messageBody,
            userId
        );

        return {
            success: true,
            message: "Message sent successfully."
        };
    } catch (error) {
        console.error("Send SMS Error:", error);
        throw new HttpsError('internal', error.message);
    }
});

/**
 * 3. Execute Campaign Batch (Company Admin)
 */
exports.executeReactivationBatch = onCall(encryptedCallOptions, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

    const { companyId, leadIds, messageText } = request.data; // leadIds is array of [leadId]

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return { success: false, message: "No leads provided." };
    }
    if (leadIds.length > 50) {
        throw new HttpsError('invalid-argument', 'Batch size limit exceeded (Max 50).');
    }
    if (!companyId) {
        throw new HttpsError('invalid-argument', 'companyId is required.');
    }

    // BULK-4 FIX: Enforce RBAC — verify the caller is a member of the specified company.
    // Without this, any authenticated user can send bulk SMS to leads belonging to any company.
    await assertCompanyAdminStrict(request.auth.uid, companyId);

    // A3 FIX: Frequency throttle. The per-call size cap (50) and RBAC above do not stop an
    // admin (or a stolen admin session) from firing back-to-back batches. 'closed' so a
    // rate-limiter system error denies rather than allows on this security/cost-sensitive path.
    const reactivationOk = await checkRateLimit(`reactivation_batch_${companyId}_${request.auth.uid}`, 5, 300, 'closed');
    if (!reactivationOk) {
        throw new HttpsError('resource-exhausted', 'Too many campaigns. Please wait a few minutes.');
    }

    // A3 (durability/cost half): instead of holding this instance open with an
    // in-process setTimeout(1000)-per-lead loop (up to ~50s of paid wall-clock,
    // non-resumable on crash, fragile against the function timeout), enqueue a
    // bulk session and let the existing recursive Cloud Tasks worker fan it out
    // — gaining pacing, idempotency, blacklist checks, progress tracking, the
    // per-session ceiling, and pause/resume for free. The reactivation leads are
    // applications under companies/{companyId}/applications/{leadId}.
    try {
        const { sessionId, targetCount } = await createAndStartBulkSession({
            companyId,
            createdBy: request.auth.uid,
            targetIds: leadIds,
            leadSourceType: 'applications',
            config: { method: 'sms', message: messageText },
            sessionName: `Reactivation ${new Date().toLocaleDateString()}`,
        });

        return {
            success: true,
            sessionId,
            queued: targetCount,
            // Sends now happen asynchronously in the worker; poll the session for progress.
            message: `Reactivation campaign queued for ${targetCount} lead(s).`,
        };
    } catch (error) {
        console.error('Reactivation enqueue error:', error);
        throw new HttpsError('internal', error.message);
    }
});
