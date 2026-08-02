/**
 * SMS provider configuration — save & verify.
 * Extracted verbatim from configController.js.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const SMSAdapterFactory = require('../../factory');
const { encrypt } = require('../../encryption');
const RingCentralAdapter = require('../../adapters/ringcentral');
const EightByEightAdapter = require('../../adapters/eightbyeight');
const { isLikelyValidPhone } = require('../../../utils/phoneUtils');
const { withStableLineIds } = require('./lineTokens');

// Shared options for functions that need encryption capabilities
const encryptedCallOptions = {
    cors: true,
    secrets: ['SMS_ENCRYPTION_KEY']
};

/**
 * 1. Save Configuration (Super Admin)
 */
exports.saveIntegrationConfig = onCall(encryptedCallOptions, async (request) => {
    // RBAC Check: Must be Super Admin (or equivalent high-privilege role)
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { companyId, provider, config } = request.data;
    if (!companyId || !provider || !config) {
        throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    // RBAC Security Check
    const membershipRef = admin.firestore().collection('memberships')
        .where('userId', '==', request.auth.uid)
        .where('companyId', '==', companyId);

    const membershipSnap = await membershipRef.get();

    // Robust Super Admin Check
    const token = request.auth.token;
    const roles = token.roles || {};
    const globalRole = token.globalRole || roles.globalRole;
    const isSuperAdmin = globalRole === 'super_admin';

    const isCompanyAdmin = !membershipSnap.empty && membershipSnap.docs[0].data().role === 'company_admin';

    if (!isSuperAdmin && !isCompanyAdmin) {
        throw new HttpsError('permission-denied', 'Only Company Admins can save integration configs.');
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
        // Only pick a new one if it's currently null/empty or if the provider changed
        const previousProvider = (existingDoc && existingDoc.exists) ? existingDoc.data().provider : null;
        const providerChanged = previousProvider && previousProvider !== provider;

        let defaultPhoneNumber = null;
        if (!providerChanged && existingDoc && existingDoc.exists) {
            defaultPhoneNumber = existingDoc.data().defaultPhoneNumber || null;
        }

        // For 8x8: use the phoneNumber from the form config if provided
        if (provider === '8x8' && config.phoneNumber) {
            defaultPhoneNumber = config.phoneNumber;
        }

        if (!defaultPhoneNumber && inventory && inventory.length > 0) {
            // Pick the first VALID line; never adopt a malformed "+"/blank entry as
            // the default (that would break line verification downstream).
            const firstValid = inventory.find(item => isLikelyValidPhone(item.phoneNumber));
            defaultPhoneNumber = firstValid ? firstValid.phoneNumber : null;
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
            inventory: withStableLineIds(finalInventory),
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

    // Check Permissions (Aligned with companyAdmin.js)
    const db = admin.firestore();
    const membershipRef = db.collection('memberships')
        .where('userId', '==', request.auth.uid)
        .where('companyId', '==', companyId);

    const membershipSnap = await membershipRef.get();

    // Robust Super Admin Check
    const token = request.auth.token;
    const roles = token.roles || {};
    const globalRole = token.globalRole || roles.globalRole;
    const isSuperAdmin = globalRole === 'super_admin';

    const isCompanyAdmin = !membershipSnap.empty && membershipSnap.docs[0].data().role === 'company_admin';

    if (!isSuperAdmin && !isCompanyAdmin) {
        throw new HttpsError('permission-denied', 'Only Company Admins can verify SMS configs.');
    }

    try {
        const adapter = await SMSAdapterFactory.getAdapter(companyId);
        if (adapter instanceof RingCentralAdapter) {
            await adapter.rc.login({ jwt: adapter.config.jwt });
            const idResp = await adapter.rc.get('/restapi/v1.0/account/~/extension/~');
            const idData = await idResp.json();
            const identity = `${idData.contact?.firstName} ${idData.contact?.lastName} (Ext: ${idData.extensionNumber}) - Acc: ${idData.account?.id}`;
            return { success: true, message: `Successfully connected to RingCentral as ${identity}.` };
        } else if (adapter instanceof EightByEightAdapter) {
            const result = await adapter.verifyConnection();
            return { success: true, message: `Successfully connected to 8x8. ${result.identity}` };
        } else {
            return { success: true, message: 'Configuration for this provider is valid.' };
        }
    } catch (error) {
        console.error("SMS Config Verification Error:", error);
        throw new HttpsError('internal', `Configuration check failed: ${error.message}`);
    }
});
