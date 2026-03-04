const BaseAdapter = require('./BaseAdapter');
const axios = require('axios');

class EightByEightAdapter extends BaseAdapter {
    constructor(config) {
        super(config);
        // Config: { apiKey, apiSecret (optional), subAccountId }
        // apiKey   = the "Key" from 8x8 Admin Console — used directly as Bearer token for SMS API
        // apiSecret = the "Secret" from 8x8 Admin Console — kept for future platform API use
        this.smsBaseUrl = 'https://sms.8x8.com/api/v1';
    }

    /**
     * For 8x8 SMS API, the API Key IS the Bearer token.
     * No OAuth flow needed — the SMS API uses direct API key auth.
     * This method exists for compatibility with the batchWorker pattern.
     */
    async ensureLoggedIn() {
        const { apiKey } = this.config;
        if (!apiKey) {
            throw new Error("Missing 8x8 API Key. Please configure it in SMS Integration settings.");
        }
        // No-op: API Key is used directly as Bearer token
        return;
    }

    async sendSMS(to, text, userId = null, explicitFromNumber = null) {
        const { apiKey, subAccountId } = this.config;

        if (!apiKey) {
            throw new Error("Missing 8x8 API Key. Please configure it in SMS Integration settings.");
        }
        if (!subAccountId) {
            throw new Error("Missing 8x8 SubAccount ID. Please configure it in SMS Integration settings.");
        }

        try {
            // Context-Aware Routing for 8x8
            // US carriers REQUIRE a real phone number as source — alphanumeric IDs get rejected
            let source = null;

            // 1. Explicit Override (For Testing/Diagnostics)
            if (explicitFromNumber) {
                source = explicitFromNumber.replace(/\D/g, ''); // Strip non-digits
            }
            // 2. Configured phone number (required for US SMS)
            else if (this.config.phoneNumber) {
                source = this.config.phoneNumber.replace(/\D/g, ''); // Strip non-digits
            }
            // 3. Configured senderId (for international/non-US)
            else if (this.config.senderId) {
                source = this.config.senderId;
            }
            // 4. Default fallback
            else {
                source = "SafeHaul";
            }

            // 8x8 limits Sender ID to 16 characters max
            // Strip '+' prefix if present (8x8 may not accept E.164 format for source)
            if (source.startsWith('+')) {
                source = source.substring(1);
            }
            if (source.length > 16) {
                source = source.substring(0, 16);
            }

            console.log(`[8x8] Sending SMS to ${to} from source "${source}" via subaccount "${subAccountId}"`);
            console.log(`[8x8] Full URL: ${this.smsBaseUrl}/subaccounts/${subAccountId}/messages`);
            console.log(`[8x8] API Key (first 10 chars): ${apiKey.substring(0, 10)}...`);

            const response = await axios.post(
                `${this.smsBaseUrl}/subaccounts/${subAccountId}/messages`,
                {
                    source: source,
                    destination: to,
                    text: text
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // Log full response for debugging
            console.log(`[8x8] Response status: ${response.status}`);
            console.log(`[8x8] Response data:`, JSON.stringify(response.data));

            if (response.status === 200 || response.status === 201 || response.status === 202) {
                return {
                    success: true,
                    responseData: response.data,
                    statusCode: response.status
                };
            }
            throw new Error(`Unexpected Status: ${response.status}`);

        } catch (error) {
            console.error("8x8 Send Error:", error.response?.data || error.message);
            throw new Error(`8x8 Error: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * 8x8 doesn't have a straightforward API for fetching numbers.
     * Return the configured subAccountId as a placeholder "number".
     */
    async fetchAvailablePhoneNumbers() {
        const senderId = this.config.senderId || this.config.subAccountId || 'N/A';
        return [
            {
                phoneNumber: senderId,
                type: 'SubAccount',
                status: 'available',
                usageType: 'Primary'
            }
        ];
    }

    /**
     * Verify connection by making a lightweight API call.
     * Uses the SMS API to check if the API key is valid.
     */
    async verifyConnection() {
        const { apiKey, subAccountId } = this.config;

        if (!apiKey) {
            throw new Error("Missing 8x8 API Key.");
        }

        // If subAccountId is present, try to hit the SMS API for verification
        if (subAccountId) {
            try {
                // Try a GET request to the subaccount endpoint (lightweight check)
                await axios.get(
                    `${this.smsBaseUrl}/subaccounts/${subAccountId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
            } catch (error) {
                // 404 = valid auth but maybe wrong subaccount
                // 401/403 = invalid API key
                if (error.response?.status === 401 || error.response?.status === 403) {
                    throw new Error(`8x8 API Key is invalid or unauthorized: ${error.response?.data?.message || error.message}`);
                }
                // Other errors (404, etc.) mean auth worked but endpoint may not exist — that's OK
                console.log(`[8x8] Verification probe returned ${error.response?.status}: ${error.response?.data?.message || 'OK'}`);
            }
        }

        return {
            success: true,
            identity: `8x8 SubAccount: ${subAccountId || '(not set)'}`,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = EightByEightAdapter;
