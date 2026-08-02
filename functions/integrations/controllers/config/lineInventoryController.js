/**
 * SMS line inventory management — add/remove phone lines ("Digital Wallet").
 * Extracted verbatim from configController.js.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { encrypt, decrypt } = require('../../encryption');
const RingCentralAdapter = require('../../adapters/ringcentral');
const { normalizePhoneForKeychain } = require('../../../utils/phoneUtils');
const { stableLineIdForPhone, withStableLineIds } = require('./lineTokens');

// Shared options for functions that need encryption capabilities
const encryptedCallOptions = {
    cors: true,
    secrets: ['SMS_ENCRYPTION_KEY']
};

/**
 * 5. Add Phone Line (Super Admin - Digital Wallet)
 */
exports.addPhoneLine = onCall(encryptedCallOptions, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

    const { companyId, phoneNumber, jwt, label, clientId, clientSecret, isSandbox } = request.data;

    // Validate required fields
    if (!companyId || !phoneNumber || !jwt) {
        throw new HttpsError('invalid-argument', 'Missing required fields: companyId, phoneNumber, jwt.');
    }

    // Permission Check: Allow Super Admin OR Company Admin (Self-Service)
    const token = request.auth.token;
    const roles = token.roles || {};
    const globalRole = token.globalRole || roles.globalRole;

    const isSuperAdmin = globalRole === 'super_admin';
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

        const sanitizedPhone = normalizePhoneForKeychain(phoneNumber);

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
            lineId: stableLineIdForPhone(sanitizedPhone),
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
            inventory: withStableLineIds(inventory),
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

/**
 * 6. Remove Phone Line (Super Admin - Digital Wallet)
 */
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

    const isSuperAdmin = globalRole === 'super_admin';
    const isCompanyAdmin = roles[companyId] === 'company_admin';

    if (!isSuperAdmin && !isCompanyAdmin) {
        console.warn(`[PermissionDenied] User: ${request.auth.uid}, GlobalRole: ${globalRole}, Target: ${companyId}`);
        throw new HttpsError('permission-denied', 'You do not have permission to remove phone lines from this company.');
    }

    const db = admin.firestore();
    const { normalizePhoneForKeychain } = require('../../../utils/phoneUtils');
    const sanitizedPhone = normalizePhoneForKeychain(phoneNumber);
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
        let inventory = withStableLineIds(data.inventory || []);
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
            inventory: withStableLineIds(inventory),
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
