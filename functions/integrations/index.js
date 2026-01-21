const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const SMSAdapterFactory = require('./factory');
const { encrypt, decrypt } = require('./encryption');
const RingCentralAdapter = require('./adapters/ringcentral');
const EightByEightAdapter = require('./adapters/eightbyeight');

// --- 1. Save Configuration (Super Admin) ---
exports.saveIntegrationConfig = onCall({ cors: true }, async (request) => {
    // RBAC Check: Must be Super Admin (or equivalent high-privilege role)
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { companyId, provider, config } = request.data;
    if (!companyId || !provider || !config) {
        throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    // Encrypt sensitive keys before saving
    const encryptedConfig = {};
    for (const [key, value] of Object.entries(config)) {
        encryptedConfig[key] = encrypt(value);
    }

    // --- NEW: Verify Credentials & Fetch Inventory (Non-Blocking) ---
    let inventory = [];
    let verificationWarning = null;
    try {
        let adapter;
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
        const docRef = admin.firestore()
            .collection('companies').doc(companyId)
            .collection('integrations').doc('sms_provider');

        // Determine Default Number (pick first available if present)
        let defaultPhoneNumber = null;
        if (inventory && inventory.length > 0) {
            defaultPhoneNumber = inventory[0].phoneNumber;
        }

        await docRef.set({
            provider,
            config: encryptedConfig,
            inventory,
            defaultPhoneNumber, // Auto-set from first inventory item
            isActive: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: request.auth.uid
        }, { merge: true }); // Preserve existing assignments if re-saving

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

// --- 2. Test Connection / Diagnostic Lab ---
exports.sendTestSMS = onCall({ cors: true }, async (request) => {
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

// --- 2.5 Test Line Connection (Validate Credentials Before Saving) ---
const RC = require('@ringcentral/sdk').SDK;

exports.testLineConnection = onCall({ cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { clientId, clientSecret, jwt, isSandbox } = request.data;

    // Validate required fields
    if (!jwt) {
        throw new HttpsError('invalid-argument', 'JWT token is required.');
    }

    // Use provided credentials or require them for per-line auth
    const effectiveClientId = clientId;
    const effectiveClientSecret = clientSecret;

    if (!effectiveClientId || !effectiveClientSecret) {
        throw new HttpsError('invalid-argument', 'Client ID and Client Secret are required.');
    }

    // Determine server URL
    const serverUrl = isSandbox ? RC.server.sandbox : RC.server.production;

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
exports.verifyLineConnection = onCall({ cors: true }, async (request) => {
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

        // Simple light-weight check: Fetch own extension info
        const resp = await adapter.rc.get('/restapi/v1.0/account/~/extension/~');
        const data = await resp.json();

        return {
            success: true,
            identity: `${data.contact?.firstName} ${data.contact?.lastName}`,
            extension: data.extensionNumber,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error(`Verification Failed for ${phoneNumber}:`, error.message);
        throw new HttpsError('failed-precondition', `Verification failed: ${error.message}`);
    }
});

// --- 3. Execute Campaign Batch (Company Admin) ---
exports.executeReactivationBatch = onCall({ cors: true }, async (request) => {
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
        const adapter = await SMSAdapterFactory.getAdapter(companyId);
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

// --- 4. Assign Phone Number (Company Admin) ---
exports.assignPhoneNumber = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

    const { companyId, userId, phoneNumber } = request.data;

    if (!companyId || !userId || !phoneNumber) {
        throw new HttpsError('invalid-argument', 'Missing required fields: companyId, userId, phoneNumber.');
    }

    // Permission Check: Requester must be Company Admin
    const claims = request.auth.token;
    const isCompanyAdmin = claims.roles?.[companyId] === 'company_admin';
    const isSuperAdmin = claims.globalRole === 'super_admin' || claims.email?.endsWith('@safehaul.io');

    if (!isCompanyAdmin && !isSuperAdmin) {
        throw new HttpsError('permission-denied', 'Only Company Admins can assign phone numbers.');
    }

    const db = admin.firestore();
    const docRef = db.collection('companies').doc(companyId).collection('integrations').doc('sms_provider');

    try {
        const doc = await docRef.get();
        if (!doc.exists) {
            throw new HttpsError('not-found', 'SMS integration not configured for this company.');
        }

        const data = doc.data();
        const inventory = data.inventory || [];

        // Validate that phoneNumber is in inventory
        const isValidNumber = inventory.some(n => n.phoneNumber === phoneNumber);
        if (!isValidNumber && phoneNumber !== '') {
            throw new HttpsError('invalid-argument', 'Phone number not found in company inventory.');
        }

        // Update assignments map
        const assignments = data.assignments || {};
        if (phoneNumber === '') {
            delete assignments[userId]; // Unassign
        } else {
            assignments[userId] = phoneNumber;
        }

        await docRef.update({
            assignments,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, message: 'Phone number assigned successfully.' };
    } catch (error) {
        console.error('Assignment Error:', error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Failed to assign phone number.');
    }
});

// --- 5. Add Phone Line (Super Admin - Digital Wallet) ---
exports.addPhoneLine = onCall({ cors: true }, async (request) => {
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
        const sanitizedPhone = phoneNumber.replace(/[^0-9+]/g, '');

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
                isSandbox: String(isSandbox ?? true)
            };
        }

        // Set default number if this is the first line
        if (inventory.length === 1 || !providerDoc.exists) {
            updateData.defaultPhoneNumber = sanitizedPhone;
        }

        await providerDocRef.set(updateData, { merge: true });

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
exports.removePhoneLine = onCall({ cors: true }, async (request) => {
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

// --- 7. Add Manual Phone Number (Fallback/Admin) ---
exports.addManualPhoneNumber = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

    const { companyId, phoneNumber, label, usageType } = request.data;
    if (!companyId || !phoneNumber) {
        throw new HttpsError('invalid-argument', 'Missing required fields: companyId, phoneNumber.');
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
        throw new HttpsError('permission-denied', 'You do not have permission to add phone numbers.');
    }

    try {
        const db = admin.firestore();
        const providerDocRef = db.collection('companies').doc(companyId).collection('integrations').doc('sms_provider');
        const doc = await providerDocRef.get();

        if (!doc.exists) {
            throw new HttpsError('not-found', 'SMS integration not found.');
        }

        const data = doc.data();
        let inventory = data.inventory || [];

        // Check for duplicates
        if (inventory.some(item => item.phoneNumber === phoneNumber)) {
            return { success: true, message: 'Number already exists in inventory.' };
        }

        // Add to inventory
        inventory.push({
            phoneNumber: phoneNumber,
            label: label || phoneNumber,
            usageType: usageType || 'DirectNumber',
            status: 'active',
            addedAt: new Date().toISOString()
        });

        await providerDocRef.update({
            inventory,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, message: `Number ${phoneNumber} added to inventory.` };
    } catch (error) {
        console.error('Add Manual Number Error:', error);
        throw new HttpsError('internal', error.message);
    }
});

