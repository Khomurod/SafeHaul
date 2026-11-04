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

    /**
     * Verify the connection and credentials
     * @returns {Promise<{success: boolean, identity: string}>}
     */
    async verifyConnection() {
        throw new Error("Method 'verifyConnection' must be implemented by concrete class.");
    }
}

// The `code` of an error for a send the provider never answered: it may have gone out.
BaseAdapter.SEND_UNCONFIRMED = 'sms-send-unconfirmed';
// That error, so every adapter words it the same way (`seconds` is its time limit).
BaseAdapter.sendUnconfirmedError = (provider, seconds) => Object.assign(
    new Error(`${provider} did not answer within ${seconds} seconds, so SafeHaul cannot tell whether this text went out. It was not sent again.`),
    { code: BaseAdapter.SEND_UNCONFIRMED },
);

module.exports = BaseAdapter;
