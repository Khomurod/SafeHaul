/**
 * Abstract Base Class for SMS Adapters
 */
class BaseAdapter {
    constructor(config) {
        this.config = config;
    }

    /**
     * Send an SMS message
     * @param {string} to - The recipient phone number (E.164 format preferably)
     * @param {string} text - The message content
     * @returns {Promise<boolean>} - True if successful
     * @throws {Error} - If implementation fails
     */
    async sendSMS(to, text, from = null) {
        throw new Error("Method 'sendSMS' must be implemented by concrete class.");
    }

    /**
     * Fetch available phone numbers from the provider
     * @returns {Promise<Array<{phoneNumber: string, type: string, status: string}>>}
     */
    async fetchAvailablePhoneNumbers() {
        throw new Error("Method 'fetchAvailablePhoneNumbers' must be implemented by concrete class.");
    }
}

module.exports = BaseAdapter;
