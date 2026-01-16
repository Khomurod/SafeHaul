const BaseAdapter = require('./BaseAdapter');
const axios = require('axios');

class EightByEightAdapter extends BaseAdapter {
    constructor(config) {
        super(config);
        // Config: { subAccountId, apiKey, region (optional) }
        this.baseUrl = config.region === 'eu'
            ? 'https://sms.8x8.com/api/v1'
            : 'https://sms.8x8.com/api/v1'; // Standard endpoint
    }

    async sendSMS(to, text, userId = null, explicitFromNumber = null) {
        try {
            const { subAccountId, apiKey } = this.config;

            // Context-Aware Routing (same logic as RingCentral)
            let fromNumber = null;

            // 1. Explicit Override (For Testing/Diagnostics)
            if (explicitFromNumber) {
                fromNumber = explicitFromNumber;
            }
            // 2. Direct Assignment (if userId provided)
            else if (userId && this.config.assignments && this.config.assignments[userId]) {
                fromNumber = this.config.assignments[userId];
            }
            // 3. Default Company Number
            else if (this.config.defaultPhoneNumber) {
                fromNumber = this.config.defaultPhoneNumber;
            }

            // 4. Fallback to configured senderId or SubAccount
            const source = fromNumber || this.config.senderId || "SafeHaul";

            const response = await axios.post(
                `${this.baseUrl}/subaccounts/${subAccountId}/messages`,
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

            if (response.status === 200 || response.status === 201 || response.status === 202) {
                return true;
            }
            throw new Error(`Unexpected Status: ${response.status}`);

        } catch (error) {
            console.error("8x8 Send Error:", error.response?.data || error.message);
            throw new Error(`8x8 Error: ${error.message}`);
        }
    }

    /**
     * 8x8 doesn't have a straightforward API for fetching numbers.
     * Return the configured subAccountId as a placeholder "number".
     */
    async fetchAvailablePhoneNumbers() {
        // 8x8 typically uses Sender IDs or SubAccount-based routing
        // Return the subAccountId as the available "number" for assignment purposes
        const senderId = this.config.senderId || this.config.subAccountId;
        return [
            {
                phoneNumber: senderId,
                type: 'SubAccount',
                status: 'available',
                usageType: 'Primary'
            }
        ];
    }
}

module.exports = EightByEightAdapter;
