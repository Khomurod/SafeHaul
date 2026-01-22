const admin = require('firebase-admin');
const { encrypt, decrypt } = require('./encryption');
const RingCentralAdapter = require('./adapters/ringcentral');
const EightByEightAdapter = require('./adapters/eightbyeight');

/**
 * Factory class to instantiate the correct SMS adapter for a company
 * Supports the "Digital Wallet" model with per-line JWT authentication
 */
class SMSAdapterFactory {

    /**
     * Get JWT for a specific phone number from the private keychain
     * @param {string} companyId 
     * @param {string} phoneNumber - The target phone number (E.164 format)
     * @returns {Promise<string>} Decrypted JWT
     */
    static async getJWTForNumber(companyId, phoneNumber) {
        const entry = await this.getKeychainEntry(companyId, phoneNumber);
        return entry.jwt;
    }

    /**
     * NEW: Get full keychain entry including per-line credentials
     * @param {string} companyId 
     * @param {string} phoneNumber 
     * @returns {Promise<{jwt: string, clientId?: string, clientSecret?: string, isSandbox?: boolean}>}
     */
    static async getKeychainEntry(companyId, phoneNumber) {
        const sanitizedPhone = phoneNumber.replace(/[^0-9+]/g, '');

        const keychainRef = admin.firestore()
            .collection('companies').doc(companyId)
            .collection('integrations').doc('sms_provider')
            .collection('keychain').doc(sanitizedPhone);

        const snap = await keychainRef.get();
        if (!snap.exists) {
            throw new Error(`No authentication key found for ${phoneNumber}. Please contact your Super Admin to provision this line.`);
        }

        const data = snap.data();
        const entry = {
            jwt: decrypt(data.jwt)
        };

        // Decrypt per-line credentials if present (Multi-Tenant Architecture)
        if (data.clientId && data.clientSecret) {
            entry.clientId = decrypt(data.clientId);
            entry.clientSecret = decrypt(data.clientSecret);
            entry.isSandbox = data.isSandbox ?? false;
        }

        return entry;
    }

    /**
     * Get an authenticated adapter instance for the given company
     * @param {string} companyId 
     * @param {string|null} targetPhoneNumber - Optional specific phone number to authenticate as
     * @returns {Promise<import('./adapters/BaseAdapter')>}
     */
    static async getAdapter(companyId, targetPhoneNumber = null) {
        if (!companyId) throw new Error("Company ID is required");

        // 1. Fetch Config from Firestore
        const docRef = admin.firestore().collection('companies').doc(companyId).collection('integrations').doc('sms_provider');
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            throw new Error(`No SMS provider configured for company: ${companyId}`);
        }

        const data = docSnap.data();
        if (!data.isActive) {
            throw new Error("SMS integration is disabled for this company.");
        }

        // 2. Decrypt shared Config (clientId, clientSecret, etc.)
        const config = {};
        for (const [key, value] of Object.entries(data.config || {})) {
            try {
                config[key] = decrypt(value);
            } catch (e) {
                console.error(`Failed to decrypt key: ${key}`, e);
                throw new Error("Configuration encryption error.");
            }
        }

        // 3. Inject Routing Data (Assignments & Default)
        config.defaultPhoneNumber = data.defaultPhoneNumber || config.defaultPhoneNumber;
        config.assignments = data.assignments || {};
        config.inventory = data.inventory || [];

        // 4. NEW: Per-Line Credentials Retrieval (Multi-Tenant Architecture)
        // If a specific target phone is requested, get its dedicated keychain entry
        let keychainEntry = null;
        const phoneToLookup = targetPhoneNumber || config.defaultPhoneNumber;

        if (phoneToLookup) {
            try {
                keychainEntry = await this.getKeychainEntry(companyId, phoneToLookup);

                // Always use the per-line JWT
                config.jwt = keychainEntry.jwt;

                // Use per-line credentials if available, otherwise keep global
                if (keychainEntry.clientId && keychainEntry.clientSecret) {
                    config.clientId = keychainEntry.clientId;
                    config.clientSecret = keychainEntry.clientSecret;
                    config.isSandbox = keychainEntry.isSandbox;
                    console.log(`[Factory] Using per-line credentials for ${phoneToLookup}`);
                } else {
                    console.log(`[Factory] Using global credentials for ${phoneToLookup}`);
                }
            } catch (keychainError) {
                console.warn(`Keychain lookup failed for ${phoneToLookup}:`, keychainError.message);
                // Fall through to legacy JWT/credentials if available
                if (!config.jwt) {
                    throw keychainError;
                }
            }
        }

        // 5. Store companyId for later keychain lookups in adapter
        config._companyId = companyId;

        // 6. Return Adapter
        switch (data.provider) {
            case 'ringcentral':
                return new RingCentralAdapter(config);
            case '8x8':
                return new EightByEightAdapter(config);
            default:
                throw new Error(`Unsupported provider: ${data.provider}`);
        }
    }

    /**
     * Get adapter configured for a specific phone number (Smart Router helper)
     * @param {string} companyId 
     * @param {string} targetPhoneNumber 
     * @returns {Promise<import('./adapters/BaseAdapter')>}
     */
    static async getAdapterForNumber(companyId, targetPhoneNumber) {
        return this.getAdapter(companyId, targetPhoneNumber);
    }
}

module.exports = SMSAdapterFactory;
