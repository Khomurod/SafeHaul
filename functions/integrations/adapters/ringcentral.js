const BaseAdapter = require('./BaseAdapter');
const RC = require('@ringcentral/sdk').SDK;

class RingCentralAdapter extends BaseAdapter {
    constructor(config) {
        super(config);
        // Config: { clientId, clientSecret, jwt, isSandbox, serverUrl (optional override) }

        let serverUrl = config.serverUrl;
        if (!serverUrl) {
            // Check for sandbox flag (handle boolean or string from DB)
            const isSandbox = config.isSandbox === true || config.isSandbox === 'true';
            serverUrl = isSandbox ? RC.server.sandbox : RC.server.production;
        }

        this.rc = new RC({
            server: serverUrl,
            clientId: config.clientId,
            clientSecret: config.clientSecret
        });
    }

    async sendSMS(to, text, userId = null, explicitFromNumber = null) {
        try {
            // Context-Aware Routing
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
            // 4. Fallback to Credentials Number
            else {
                fromNumber = this.config.phoneNumber;
            }

            // Login with JWT
            await this.rc.login({ jwt: this.config.jwt });

            // Send Request
            const payload = {
                to: [{ phoneNumber: to }],
                text: text
            };

            // Only add 'from' if we determined one. 
            // If not, RingCentral uses the authorized user's default number (risky, but valid fallback)
            if (fromNumber) {
                payload.from = { phoneNumber: fromNumber };
            }

            console.log(`[RC Adapter] Sending SMS | From: ${fromNumber || 'Default'} | To: ${to}`);

            await this.rc.post('/restapi/v1.0/account/~/extension/~/sms', payload);

            return true;
        } catch (error) {
            const responseData = error.response?.data;
            const errorCode = responseData?.errorCode || 'Unknown';
            const errorMsg = responseData?.message || error.message;

            console.error("RingCentral Send Error:", JSON.stringify(responseData || error.message));

            let userFriendlyError = `RingCentral Error [${errorCode}]: ${errorMsg}`;

            switch (errorCode) {
                case 'InvalidAuthentication':
                    userFriendlyError = "Authentication with RingCentral failed. Please verify your JWT token and credentials.";
                    break;
                case 'InvalidRequest':
                    if (errorMsg.includes('PhoneNumber.from')) {
                        userFriendlyError = "Invalid 'From' number. Please ensure the selected number is provisioned for SMS in your RingCentral account.";
                    }
                    break;
                case 'FeatureNotAvailable':
                    userFriendlyError = "SMS feature is not available for this account or user. Please check your RingCentral plan and permissions.";
                    break;
            }

            // Return Detailed Error to Frontend
            // format: "RingCentral Error [FeatureNotAvailable]: The requested feature is not available"
            throw new Error(userFriendlyError);
        }
    }

    async fetchAvailablePhoneNumbers() {
        this.lastSyncMeta = { accCount: 0, extCount: 0, rawCount: 0, sampleKeys: [], identity: 'Unknown' };
        try {
            await this.rc.login({ jwt: this.config.jwt });

            // Get Identity first
            const idResp = await this.rc.get('/restapi/v1.0/account/~/extension/~');
            const idData = await idResp.json();
            this.lastSyncMeta.identity = `${idData.contact?.firstName} ${idData.contact?.lastName} (Ext: ${idData.extensionNumber}) - Acc: ${idData.account?.id}`;

            // Fetch from both Account level and Extension (User) level
            // Some numbers only appear at the account level (Main Numbers)
            // Some only at extension level (Direct Lines)
            const [accResp, extResp] = await Promise.all([
                this.rc.get('/restapi/v1.0/account/~/phone-number'),
                this.rc.get('/restapi/v1.0/account/~/extension/~/phone-number')
            ]);

            const accData = await accResp.json();
            const extData = await extResp.json();

            const accRecords = accData.records || [];
            const extRecords = extData.records || [];

            this.lastSyncMeta.accCount = accRecords.length;
            this.lastSyncMeta.extCount = extRecords.length;

            if (accRecords.length > 0) {
                this.lastSyncMeta.sampleKeys = Object.keys(accRecords[0]);
            }

            const allRecords = [...accRecords, ...extRecords];

            // Deduplicate by phoneNumber
            const uniqueRecords = Array.from(new Map(allRecords.map(item => [item.phoneNumber, item])).values());
            this.lastSyncMeta.rawCount = uniqueRecords.length;

            // Filter for numbers that are likely SMS capable (Relaxed filter)
            const filtered = uniqueRecords
                .filter(record => record.phoneNumber && record.type !== 'FaxOnly')
                .map(record => {
                    // Force E.164 sanitization (remove all except numbers and +)
                    const sanitized = (record.phoneNumber || "").replace(/[^0-9+]/g, '');
                    // Ensure it has a leading +
                    const finalPhone = sanitized.startsWith('+') ? sanitized : `+${sanitized}`;

                    return {
                        phoneNumber: finalPhone,
                        type: record.type,           // e.g. VoiceFax
                        usageType: record.usageType, // e.g. DirectNumber
                        paymentType: record.paymentType,
                        status: 'available',         // Default status
                        assignedTo: null             // Not assigned yet
                    };
                });

            return filtered;
        } catch (error) {
            console.error("RC Fetch Inventory Error [Diagnostic]:", error);
            const detailedError = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            throw new Error(`Failed to fetch number inventory: ${detailedError}`);
        }
    }

    async verifyConnection() {
        try {
            await this.rc.login({ jwt: this.config.jwt });
            const idResp = await this.rc.get('/restapi/v1.0/account/~/extension/~');
            const data = await idResp.json();
            return {
                success: true,
                identity: `${data.contact?.firstName} ${data.contact?.lastName}`,
                extension: data.extensionNumber,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error("RC Connection Verification Error:", error.message);
            throw error;
        }
    }
}

module.exports = RingCentralAdapter;
