const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const SMSAdapterFactory = require('../factory');

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
        // NEW: Use per-line JWT routing if a specific fromNumber is provided
        // This gets an adapter authenticated with that line's specific JWT from the keychain
        const adapter = fromNumber
            ? await SMSAdapterFactory.getAdapterForNumber(companyId, fromNumber)
            : await SMSAdapterFactory.getAdapter(companyId);

        // Pass 'fromNumber' as the 4th argument (explicit override for testing)
        // Pass request.auth.uid as 3rd arg (userId context)
        await adapter.sendSMS(
            testPhoneNumber,
            "SafeHaul Diagnostic Test: This message confirms your line is active.",
            request.auth.uid,
            fromNumber || null
        );

        return {
            success: true,
            message: "Test message sent successfully.",
            sentFrom: fromNumber || 'default'
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

    // Validation
    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return { success: false, message: "No leads provided." };
    }
    if (leadIds.length > 50) {
        throw new HttpsError('invalid-argument', 'Batch size limit exceeded (Max 50).');
    }

    // Permission Check: User should belong to this company (simplified here)
    // In real app, check request.auth.token.claims.companyId === companyId

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    try {
        // Batch execution now uses recruiter-specific routing
        const adapter = await SMSAdapterFactory.getAdapterForUser(companyId, request.auth.uid);
        const db = admin.firestore();

        // Loop with Delay
        for (const leadId of leadIds) {
            try {
                // 1. Rate Limit Sleep (1000ms)
                await new Promise(resolve => setTimeout(resolve, 1000));

                // 2. Fetch Lead Phone
                // Data might be in leads/{id} or companies/{id}/applications/{id} depending on structure
                // Assuming company leads structure for Company Admin campaigns
                const leadRef = db.collection('companies').doc(companyId).collection('applications').doc(leadId); // or generic leads
                const leadSnap = await leadRef.get();

                if (!leadSnap.exists) {
                    errors.push(`Lead not found: ${leadId}`);
                    failCount++;
                    continue;
                }

                const leadData = leadSnap.data();
                const phone = leadData.phone || leadData.phoneNumber;

                if (!phone) {
                    errors.push(`Lead ${leadId} has no phone number`);
                    failCount++;
                    continue;
                }

                // 3. Send SMS
                // Inject variables if needed (simple replacement)
                let finalMsg = messageText.replace('[Driver Name]', leadData.firstName || 'Driver');

                await adapter.sendSMS(phone, finalMsg, request.auth.uid);

                // 4. Update Status
                await leadRef.update({
                    lastContactedAt: admin.firestore.FieldValue.serverTimestamp(),
                    status: 'Reactivation Attempted',
                    [`campaignLogs.${Date.now()}`]: {
                        action: 'sms_sent',
                        message: finalMsg,
                        sentFrom: adapter.config.assignments?.[request.auth.uid] || adapter.config.defaultPhoneNumber || 'default',
                        sentBy: request.auth.uid,
                        status: 'success'
                    }
                });

                successCount++;

            } catch (innerError) {
                console.error(`Failed for lead ${leadId}:`, innerError);
                failCount++;
                errors.push(`Lead ${leadId}: ${innerError.message}`);

                // Try to log failure to doc
                try {
                    await db.collection('companies').doc(companyId).collection('applications').doc(leadId).update({
                        [`campaignLogs.${Date.now()}`]: { action: 'sms_failed', error: innerError.message }
                    });
                } catch (e) { /* ignore */ }
            }
        }

        return {
            success: true,
            stats: { total: leadIds.length, sent: successCount, failed: failCount },
            errors: errors.slice(0, 5) // Return first 5 errors to avoid huge payload
        };

    } catch (error) {
        console.error("Batch Execution Error:", error);
        throw new HttpsError('internal', error.message);
    }
});
