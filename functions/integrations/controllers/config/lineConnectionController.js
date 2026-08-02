/**
 * SMS line connection checks — test credentials before saving and verify
 * existing lines. Extracted verbatim from configController.js.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const SMSAdapterFactory = require('../../factory');
const { decrypt } = require('../../encryption');
const RC = require('@ringcentral/sdk').SDK;
const { isLikelyValidPhone } = require('../../../utils/phoneUtils');

// Shared options for functions that need encryption capabilities
const encryptedCallOptions = {
    cors: true,
    secrets: ['SMS_ENCRYPTION_KEY']
};

/**
 * 2.5 Test Line Connection (Validate Credentials Before Saving)
 */
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

/**
 * 2.6 Verify Existing Line Connection (For Company Admins)
 */
exports.verifyLineConnection = onCall(encryptedCallOptions, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { companyId, phoneNumber } = request.data;
    if (!companyId || !phoneNumber) {
        throw new HttpsError('invalid-argument', 'Company ID and Phone Number are required.');
    }
    // Reject malformed numbers (e.g. the bare "+") before the keychain lookup, so the
    // user gets an actionable message instead of "No authentication key found for +".
    if (!isLikelyValidPhone(phoneNumber)) {
        throw new HttpsError('invalid-argument', 'Select a valid phone line to verify.');
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
        throw new HttpsError('permission-denied', 'Only Company Admins can verify connections.');
    }

    try {
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
