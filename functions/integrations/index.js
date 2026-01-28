const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const SMSAdapterFactory = require('./factory');
const { encrypt, decrypt } = require('./encryption');
const RingCentralAdapter = require('./adapters/ringcentral');
const EightByEightAdapter = require('./adapters/eightbyeight');

// Shared options for functions that need encryption capabilities
// secrets array uses string format - Firebase will inject SMS_ENCRYPTION_KEY into process.env
const encryptedCallOptions = {
    cors: true,
    secrets: ['SMS_ENCRYPTION_KEY']
};

// --- 1. Save Configuration (Super Admin) ---
exports.saveIntegrationConfig = onCall(encryptedCallOptions, async (request) => {
    // RBAC Check: Must be Super Admin (or equivalent high-privilege role)
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { companyId, provider, config } = request.data;
    if (!companyId || !provider || !config) {
        throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    // CRITICAL: Fetch existing config to preserve credentials if __PRESERVE__ marker is sent
    const docRef = admin.firestore()
        .collection('companies').doc(companyId)
        .collection('integrations').doc('sms_provider');

    let existingConfig = {};
    let existingDoc = null;
    try {
        existingDoc = await docRef.get();
        if (existingDoc.exists) {
            existingConfig = existingDoc.data().config || {};
        }
    } catch (fetchError) {
        console.warn('[saveIntegrationConfig] Could not fetch existing config:', fetchError.message);
    }

    // Build the final configuration, handling non-string values appropriately.
    const finalConfig = { ...existingConfig }; // Start with existing to preserve untouched fields

    for (const [key, value] of Object.entries(config)) {
        // Skip encryption for 'isSandbox' and store its boolean value directly.
        if (key === 'isSandbox') {
            finalConfig[key] = value;
            continue;
        }

        // Handle the preservation of existing encrypted values.
        if (value === '__PRESERVE__') {
            // If __PRESERVE__ is sent, but there's no existing value, we simply do nothing,
            // effectively ignoring it, rather than trying to encrypt the marker.
            if (existingConfig[key]) {
                finalConfig[key] = existingConfig[key];
            }
            continue; // Move to the next item.
        }

        // For all other keys, encrypt the value if it's not empty.
        if (value) {
            finalConfig[key] = encrypt(value);
        } else {
            // If an existing field is cleared (empty value submitted), remove it.
            delete finalConfig[key];
        }
    }

    // --- NEW: Verify Credentials & Fetch Inventory (Non-Blocking) ---
    let inventory = [];
    let verificationWarning = null;
    let adapter = null;
    try {
        // IMPORTANT: Use the raw, unencrypted config for adapter instantiation for verification
        if (provider === 'ringcentral') {
            adapter = new RingCentralAdapter(config);
        } else if (provider === '8x8') {
            adapter = new EightByEightAdapter(config);
        }

        if (adapter && adapter.fetchAvailablePhoneNumbers) {
            inventory = await adapter.fetchAvailablePhoneNumbers();
            console.log(`Inventory Sync: Fetched ${inventory.length} numbers for ${provider}`);
        }
    } catch (error) {
        console.warn("Integration Verification Failed (Non-Blocking):", error);
        verificationWarning = `Credentials saved, but verification failed: ${error.message}. You may need to enter phone numbers manually or check your credentials later.`;
    }

    try {
        // Determine Default Number
        // Only pick a new one if it's currently null/empty
        let defaultPhoneNumber = (existingDoc && existingDoc.exists) ? existingDoc.data().defaultPhoneNumber : null;
        if (!defaultPhoneNumber && inventory && inventory.length > 0) {
            defaultPhoneNumber = inventory[0].phoneNumber;
        }

        // --- INVENTORY MERGE STRATEGY ---
        // Syncing with provider (inventory) might miss:
        // 1. Dedicated lines (added via addPhoneLine with own JWTs)
        // 2. Manually added lines
        // We MUST preserve these.

        let finalInventory = [...inventory]; // Start with the fresh sync

        if (existingDoc && existingDoc.exists) {
            const currentInventory = existingDoc.data().inventory || [];

            // Find items to preserve:
            // - Ones with hasDedicatedCredentials
            // - Ones that were manually added (usageType === 'DirectNumber' but not in the fresh sync)
            const toPreserve = currentInventory.filter(existingItem => {
                const inFreshSync = inventory.some(newItem => newItem.phoneNumber === existingItem.phoneNumber);
                return !inFreshSync && (existingItem.hasDedicatedCredentials || existingItem.usageType === 'DirectNumber');
            });

            if (toPreserve.length > 0) {
                console.log(`[Inventory Merge] Preserving ${toPreserve.length} dedicated/manual lines.`);
                finalInventory = [...finalInventory, ...toPreserve];
            }
        }

        await docRef.set({
            provider,
            config: finalConfig,
            inventory: finalInventory,
            defaultPhoneNumber,
            isActive: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: request.auth.uid
        }, { merge: true });

        return {
            success: true,
            warning: verificationWarning,
            inventoryCount: inventory.length,
            syncMeta: adapter?.lastSyncMeta || null
        };
    } catch (error) {
        console.error("Save Config Error:", error);
        throw new HttpsError('internal', 'Failed to save configuration.');
    }
});

exports.verifySmsConfig = onCall(encryptedCallOptions, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const { companyId } = request.data;
    if (!companyId) {
        throw new HttpsError('invalid-argument', 'Missing companyId.');
    }

    try {
        const adapter = await SMSAdapterFactory.getAdapter(companyId);
        if (adapter instanceof RingCentralAdapter) {
            await adapter.rc.login({ jwt: adapter.config.jwt });
            const idResp = await adapter.rc.get('/restapi/v1.0/account/~/extension/~');
            const idData = await idResp.json();
            const identity = `${idData.contact?.firstName} ${idData.contact?.lastName} (Ext: ${idData.extensionNumber}) - Acc: ${idData.account?.id}`;
            return { success: true, message: `Successfully connected to RingCentral as ${identity}.` };
        } else {
            return { success: true, message: 'Configuration for this provider is valid.' };
        }
    } catch (error) {
        console.error("SMS Config Verification Error:", error);
        throw new HttpsError('internal', `Configuration check failed: ${error.message}`);
    }
});

// --- 2. Test Connection / Diagnostic Lab ---
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

// --- 2.1 Send Real SMS (Outbound) ---
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

// --- 2.5 Test Line Connection (Validate Credentials Before Saving) ---
const RC = require('@ringcentral/sdk').SDK;

exports.testLineConnection = onCall(encryptedCallOptions, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { companyId, clientId, clientSecret, jwt, isSandbox } = request.data;

    // Validate required fields
    if (!jwt) {
        throw new HttpsError('invalid-argument', 'JWT token is required.');
    }

    // Start with provided credentials
    let effectiveClientId = clientId;
    let effectiveClientSecret = clientSecret;
    let effectiveIsSandbox = isSandbox;

    // If credentials not provided, fetch shared credentials from company config
    if ((!effectiveClientId || !effectiveClientSecret) && companyId) {
        try {
            const providerDoc = await admin.firestore()
                .collection('companies').doc(companyId)
                .collection('integrations').doc('sms_provider')
                .get();

            if (providerDoc.exists) {
                const config = providerDoc.data().config || {};
                if (config.clientId && config.clientSecret) {
                    effectiveClientId = decrypt(config.clientId);
                    effectiveClientSecret = decrypt(config.clientSecret);
                    effectiveIsSandbox = config.isSandbox === 'true' || config.isSandbox === true;
                    console.log('[testLineConnection] Using shared credentials from company config');
                }
            }
        } catch (fetchError) {
            console.error('[testLineConnection] Failed to fetch shared credentials:', fetchError.message);
            // Continue - will fail on the check below if still missing
        }
    }

    if (!effectiveClientId || !effectiveClientSecret) {
        throw new HttpsError('invalid-argument',
            'Client ID and Client Secret are required. Save shared credentials first or enable per-line credentials.');
    }

    // Determine server URL
    const serverUrl = effectiveIsSandbox ? RC.server.sandbox : RC.server.production;

    try {
        // Instantiate isolated SDK with the provided credentials
        const rcsdk = new RC({
            server: serverUrl,
            clientId: effectiveClientId,
            clientSecret: effectiveClientSecret
        });

        // Attempt JWT login
        await rcsdk.login({ jwt: jwt });

        // Fetch account info to verify connection
        const accountResp = await rcsdk.get('/restapi/v1.0/account/~');
        const accountData = await accountResp.json();

        // Fetch extension info for identity
        const extResp = await rcsdk.get('/restapi/v1.0/account/~/extension/~');
        const extData = await extResp.json();

        // Fetch phone numbers available to this extension
        const phoneResp = await rcsdk.get('/restapi/v1.0/account/~/extension/~/phone-number');
        const phoneData = await phoneResp.json();

        return {
            success: true,
            message: `Connected as ${extData.contact?.firstName} ${extData.contact?.lastName}`,
            accountId: accountData.id,
            extensionName: extData.contact?.firstName + ' ' + extData.contact?.lastName,
            availableNumbers: phoneData.records || []
        };
    } catch (error) {
        console.error("RC Connection Test Failed:", error.message);
        throw new HttpsError('failed-precondition', `Connection Failed: ${error.message}`);
    }
});

// --- 2.6 Verify Existing Line Connection (For Company Admins) ---
exports.verifyLineConnection = onCall(encryptedCallOptions, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { companyId, phoneNumber } = request.data;
    if (!companyId || !phoneNumber) {
        throw new HttpsError('invalid-argument', 'Company ID and Phone Number are required.');
    }

    // Check Permissions (Aligned with companyAdmin.js)
    const db = admin.firestore();
    const membershipRef = db.collection('memberships')
        .where('userId', '==', request.auth.uid)
        .where('companyId', '==', companyId);

    const membershipSnap = await membershipRef.get();
    const isSuperAdmin = request.auth.token.role === 'super_admin';
    const isCompanyAdmin = !membershipSnap.empty && membershipSnap.docs[0].data().role === 'company_admin';

    if (!isSuperAdmin && !isCompanyAdmin) {
        throw new HttpsError('permission-denied', 'Only Company Admins can verify connections.');
    }

    try {
        const SMSAdapterFactory = require('./factory');
        const adapter = await SMSAdapterFactory.getAdapter(companyId, phoneNumber);

        // Standardized verification via adapter
        const result = await adapter.verifyConnection();

        // SELF-HEALING: Ensure this number is in the global index
        // This acts as a lazy backfill for existing lines
        const sanitizedPhone = phoneNumber.replace(/[^0-9+]/g, '');
        try {
            const indexRef = db.collection('integrations_index').doc(`sms_${sanitizedPhone}`);
            const indexDoc = await indexRef.get();
            if (!indexDoc.exists) {
                console.log(`[Self-Healing] Backfilling global index for ${sanitizedPhone}`);
                await indexRef.set({
                    companyId: companyId,
                    type: 'sms',
                    provider: 'ringcentral',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        } catch (idxError) {
            console.error('Index check failed:', idxError);
        }

        return {
            ...result,
            success: true
        };
    } catch (error) {
        console.error(`Verification Failed for ${phoneNumber}:`, error.message);
        throw new HttpsError('failed-precondition', `Verification failed: ${error.message}`);
    }
});

// --- 3. Execute Campaign Batch (Company Admin) ---
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

// REMOVED: assignPhoneNumber - now handled via direct Firestore updates


// --- 5. Add Phone Line (Super Admin - Digital Wallet) ---
exports.addPhoneLine = onCall(encryptedCallOptions, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

    const { companyId, phoneNumber, jwt, label, clientId, clientSecret, isSandbox } = request.data;

    // Validate required fields
    if (!companyId || !phoneNumber || !jwt) {
        throw new HttpsError('invalid-argument', 'Missing required fields: companyId, phoneNumber, jwt.');
    }

    // Permission Check: Allow Super Admin OR Company Admin (Self-Service)
    // Permission Check: Allow Super Admin OR Company Admin (Self-Service)
    const token = request.auth.token;
    const roles = token.roles || {};
    const globalRole = token.globalRole || roles.globalRole;

    const isSuperAdmin = globalRole === 'super_admin' || token.email?.endsWith('@safehaul.io');
    const isCompanyAdmin = roles[companyId] === 'company_admin';

    if (!isSuperAdmin && !isCompanyAdmin) {
        console.warn(`[PermissionDenied] User: ${request.auth.uid}, GlobalRole: ${globalRole}, Target: ${companyId}`);
        throw new HttpsError('permission-denied', 'You do not have permission to add phone lines to this company.');
    }

    const db = admin.firestore();
    const providerDocRef = db.collection('companies').doc(companyId).collection('integrations').doc('sms_provider');

    try {
        // 1. Verify JWT by attempting a dry-run login
        let verificationResult = null;
        try {
            // Use the shared credentials (clientId/clientSecret) if provided, or fetch from existing config
            let testClientId = clientId;
            let testClientSecret = clientSecret;
            let testIsSandbox = isSandbox;

            if (!testClientId || !testClientSecret) {
                // Fetch existing shared credentials
                const existingDoc = await providerDocRef.get();
                if (existingDoc.exists) {
                    const existingConfig = existingDoc.data().config || {};
                    testClientId = testClientId || decrypt(existingConfig.clientId);
                    testClientSecret = testClientSecret || decrypt(existingConfig.clientSecret);
                    testIsSandbox = testIsSandbox ?? (existingConfig.isSandbox === 'true' || existingConfig.isSandbox === true);
                }
            }

            if (!testClientId || !testClientSecret) {
                throw new Error('No shared credentials found. Please configure clientId and clientSecret first.');
            }

            // Create a temporary adapter to test the JWT
            const testAdapter = new RingCentralAdapter({
                clientId: testClientId,
                clientSecret: testClientSecret,
                jwt: jwt,
                isSandbox: testIsSandbox
            });

            // Test login and verify the phone number is accessible
            await testAdapter.rc.login({ jwt: jwt });
            const extInfo = await testAdapter.rc.get('/restapi/v1.0/account/~/extension/~');
            const extData = await extInfo.json();
            verificationResult = {
                verified: true,
                identity: `${extData.contact?.firstName} ${extData.contact?.lastName} (Ext: ${extData.extensionNumber})`
            };
        } catch (verifyError) {
            console.error('JWT Verification Failed:', verifyError);
            throw new HttpsError('invalid-argument', `JWT verification failed: ${verifyError.message}. Please ensure the JWT is valid and associated with this phone number.`);
        }

        // 2. Sanitize phone number for document ID
        const rawSanitized = phoneNumber.replace(/[^0-9+]/g, '');
        const sanitizedPhone = rawSanitized.startsWith('+') ? rawSanitized : `+${rawSanitized}`;

        // 3. Store encrypted JWT + Per-Line Credentials in Private Keychain (subcollection)
        const keychainRef = providerDocRef.collection('keychain').doc(sanitizedPhone);
        const keychainData = {
            phoneNumber: sanitizedPhone,
            jwt: encrypt(jwt),
            label: label || sanitizedPhone,
            addedAt: admin.firestore.FieldValue.serverTimestamp(),
            addedBy: request.auth.uid,
            lastVerified: admin.firestore.FieldValue.serverTimestamp(),
            verifiedIdentity: verificationResult?.identity || null
        };

        // NEW: Store per-line credentials if provided (Multi-Tenant Architecture)
        if (clientId && clientSecret) {
            keychainData.clientId = encrypt(clientId);
            keychainData.clientSecret = encrypt(clientSecret);
            keychainData.isSandbox = isSandbox ?? false;
        }

        await keychainRef.set(keychainData);

        // 4. Add to Public Inventory (visible to Company Admins)
        const providerDoc = await providerDocRef.get();
        let inventory = [];
        let existingConfig = {};

        if (providerDoc.exists) {
            inventory = providerDoc.data().inventory || [];
            existingConfig = providerDoc.data().config || {};
        }

        // Remove any existing entry for this number before adding
        inventory = inventory.filter(item => item.phoneNumber !== sanitizedPhone);

        // Add new entry
        inventory.push({
            phoneNumber: sanitizedPhone,
            label: label || sanitizedPhone,
            status: 'active',
            usageType: 'DirectNumber',
            addedAt: new Date().toISOString(),
            hasDedicatedCredentials: !!(clientId && clientSecret)
        });

        // 5. Update provider doc with inventory (and shared credentials if provided)
        const updateData = {
            provider: 'ringcentral',
            isActive: true,
            inventory: inventory,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: request.auth.uid
        };

        // Store/update shared credentials if provided
        if (clientId && clientSecret) {
            updateData.config = {
                ...existingConfig,
                clientId: encrypt(clientId),
                clientSecret: encrypt(clientSecret),
                isSandbox: isSandbox ?? false
            };
        }

        // Set default number if this is the first line
        if (inventory.length === 1 || !providerDoc.exists) {
            updateData.defaultPhoneNumber = sanitizedPhone;
        }

        await providerDocRef.set(updateData, { merge: true });

        // 6. GLOBAL INDEX UPDATE (For Incoming Webhooks)
        // integrations_index/sms_+15550000
        try {
            await db.collection('integrations_index').doc(`sms_${sanitizedPhone}`).set({
                companyId: companyId,
                type: 'sms',
                provider: 'ringcentral',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (idxError) {
            console.error(`Failed to update global index for ${sanitizedPhone}:`, idxError);
            // Non-fatal, but logs needed
        }

        return {
            success: true,
            phoneNumber: sanitizedPhone,
            message: `Line ${sanitizedPhone} added successfully.`,
            verification: verificationResult
        };

    } catch (error) {
        console.error('Add Phone Line Error:', error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', `Failed to add phone line: ${error.message}`);
    }
});

// --- 6. Remove Phone Line (Super Admin - Digital Wallet) ---
exports.removePhoneLine = onCall(encryptedCallOptions, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

    const { companyId, phoneNumber } = request.data;

    if (!companyId || !phoneNumber) {
        throw new HttpsError('invalid-argument', 'Missing required fields: companyId, phoneNumber.');
    }

    // Permission Check: Allow Super Admin OR Company Admin (Self-Service)
    const token = request.auth.token;
    const roles = token.roles || {};
    const globalRole = token.globalRole || roles.globalRole;

    const isSuperAdmin = globalRole === 'super_admin' || token.email?.endsWith('@safehaul.io');
    const isCompanyAdmin = roles[companyId] === 'company_admin';

    if (!isSuperAdmin && !isCompanyAdmin) {
        console.warn(`[PermissionDenied] User: ${request.auth.uid}, GlobalRole: ${globalRole}, Target: ${companyId}`);
        throw new HttpsError('permission-denied', 'You do not have permission to remove phone lines from this company.');
    }

    const db = admin.firestore();
    const sanitizedPhone = phoneNumber.replace(/[^0-9+]/g, '');
    const providerDocRef = db.collection('companies').doc(companyId).collection('integrations').doc('sms_provider');
    const keychainRef = providerDocRef.collection('keychain').doc(sanitizedPhone);

    try {
        // 1. Delete JWT from Private Keychain
        await keychainRef.delete();

        // 2. Remove from Public Inventory
        const providerDoc = await providerDocRef.get();
        if (!providerDoc.exists) {
            return { success: true, message: 'No SMS configuration found.' };
        }

        const data = providerDoc.data();
        let inventory = data.inventory || [];
        const assignments = data.assignments || {};

        // Remove from inventory
        inventory = inventory.filter(item => item.phoneNumber !== sanitizedPhone);

        // 3. Clear any assignments using this number
        const updatedAssignments = { ...assignments };
        for (const [userId, assignedNumber] of Object.entries(updatedAssignments)) {
            if (assignedNumber === sanitizedPhone) {
                delete updatedAssignments[userId];
            }
        }

        // 4. Update default number if it was removed
        let defaultPhoneNumber = data.defaultPhoneNumber;
        if (defaultPhoneNumber === sanitizedPhone) {
            defaultPhoneNumber = inventory.length > 0 ? inventory[0].phoneNumber : null;
        }

        await providerDocRef.update({
            inventory: inventory,
            assignments: updatedAssignments,
            defaultPhoneNumber: defaultPhoneNumber,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 5. GLOBAL INDEX REMOVAL
        try {
            await db.collection('integrations_index').doc(`sms_${sanitizedPhone}`).delete();
        } catch (idxError) {
            console.error(`Failed to remove global index for ${sanitizedPhone}:`, idxError);
        }

        return {
            success: true,
            message: `Line ${sanitizedPhone} removed successfully.`,
            clearedAssignments: Object.keys(assignments).length - Object.keys(updatedAssignments).length
        };

    } catch (error) {
        console.error('Remove Phone Line Error:', error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', `Failed to remove phone line: ${error.message}`);
    }
});

// REMOVED: addManualPhoneNumber - now handled via direct Firestore updates on the frontend.


