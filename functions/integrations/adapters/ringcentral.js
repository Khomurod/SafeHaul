const BaseAdapter = require('./BaseAdapter');
const RC = require('@ringcentral/sdk').SDK;
const { isLikelyValidPhone } = require('../../utils/phoneUtils');

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

        this._loggedIn = false; // Track login state for session caching
    }

    /**
     * Login only if not already authenticated. Reuses existing session.
     */
    async ensureLoggedIn() {
        if (this._loggedIn) {
            try {
                // Check if platform token is still valid
                const platform = this.rc.platform();
                if (await platform.loggedIn()) return;
            } catch { /* fall through to re-login */ }
        }
        await this.rc.login({ jwt: this.config.jwt });
        this._loggedIn = true;
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

            // Login with JWT (cached — only authenticates once per adapter instance)
            await this.ensureLoggedIn();

            // BUG-9 FIX: Removed shadowed payload variable that was dead code.
            // 5. Attempt Send with Fallback Logic
            try {
                // First Attempt: Preferred 'From' Number
                const payload = {
                    to: [{ phoneNumber: to }],
                    text: text
                };
                if (fromNumber) {
                    payload.from = { phoneNumber: fromNumber };
                }

                console.log(`[RC Adapter] Sending SMS | From: ${fromNumber || 'Default'} | To: ${to}`);
                await this._sendWithRetry('/restapi/v1.0/account/~/extension/~/sms', payload);
                return true;

            } catch (primaryError) {
                // BUG-8 FIX: Only fallback on DETERMINISTIC permission errors (4xx).
                // Timeouts and 5xx errors may have already delivered the message —
                // falling back would risk double-sending.
                const statusCode = primaryError.response?.status;
                const isClientError = statusCode && statusCode >= 400 && statusCode < 500;

                const isPermissionError = isClientError && (
                    (primaryError.message || "").includes('PhoneNumber.from') ||
                    (primaryError.response?.data?.errorCode === 'FeatureNotAvailable') ||
                    (primaryError.response?.data?.errorCode === 'InvalidParameter')
                );

                const responseMessage = primaryError.response?.data?.message || primaryError.message || '';
                const fromRejectedByRingCentral = isClientError && (
                    /phone number doesn't belong to extension/i.test(responseMessage) ||
                    /parameter \[from\] value is invalid/i.test(responseMessage) ||
                    /PhoneNumber\.from/i.test(responseMessage)
                );

                // If RingCentral rejects the configured `from` line before delivery, retry
                // once without `from` so the authenticated JWT extension can use its default
                // SMS sender. This covers provider-side ownership/format mismatches such as
                // "Phone number doesn't belong to extension" and "Parameter [from] value
                // is invalid" without risking double-sends on timeouts or 5xx errors.
                if (fromNumber && fromRejectedByRingCentral) {
                    console.warn(`[RC Adapter] RingCentral rejected from line ${fromNumber}. Retrying without explicit from.`);
                    const noFromPayload = {
                        to: [{ phoneNumber: to }],
                        text: text
                    };
                    await this._sendWithRetry('/restapi/v1.0/account/~/extension/~/sms', noFromPayload);
                    return true;
                }

                const canFallback = fromNumber && fromNumber !== this.config.defaultPhoneNumber && isPermissionError;

                if (canFallback) {
                    console.warn(`[RC Adapter] Primary send failed (${primaryError.message}). Falling back to Default Line (${this.config.defaultPhoneNumber}).`);

                    try {
                        const fallbackPayload = {
                            to: [{ phoneNumber: to }],
                            text: text,
                            from: { phoneNumber: this.config.defaultPhoneNumber }
                        };

                        await this._sendWithRetry('/restapi/v1.0/account/~/extension/~/sms', fallbackPayload);
                        console.log(`[RC Adapter] Fallback success!`);
                        return true;

                    } catch (fallbackError) {
                        console.error(`[RC Adapter] Fallback also failed: ${fallbackError.message}`);
                        // Update error info to reflect the fallback failure, but keep context
                        throw this._normalizeError(fallbackError);
                    }
                }

                // If no fallback possible, throw original
                throw this._normalizeError(primaryError);
            }

        } catch (error) {
            // Error is already normalized if re-thrown above, but double check
            if (error.message && error.message.startsWith('RingCentral Error')) throw error;
            throw this._normalizeError(error);
        }
    }

    _normalizeError(error) {
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
                    userFriendlyError = "Invalid 'From' number. The assigned line is not authorized for this account. (Fallback failed)";
                }
                break;
            case 'FeatureNotAvailable':
                userFriendlyError = "SMS feature is not available for this line/user. (Fallback failed)";
                break;
            case 'RateLimitExceeded': // Catch rate limits specifically
                userFriendlyError = "RingCentral Rate Limit Exceeded. Please slow down.";
                break;
        }
        return new Error(userFriendlyError);
    }

    /**
     * Send with retry on rate limit errors (exponential backoff).
     * Retries up to 3 times with delays: 5s, 10s, 20s.
     */
    async _sendWithRetry(url, payload, maxRetries = 3) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await this.rc.post(url, payload);
                return; // Success
            } catch (err) {
                const msg = err.response?.data?.message || err.message || '';
                const isRateLimit = msg.toLowerCase().includes('rate') ||
                    err.response?.status === 429;

                if (isRateLimit && attempt < maxRetries) {
                    const waitSec = 5 * Math.pow(2, attempt); // 5s, 10s, 20s
                    console.warn(`[RC Adapter] Rate limited (attempt ${attempt + 1}/${maxRetries + 1}). Waiting ${waitSec}s...`);
                    await new Promise(r => setTimeout(r, waitSec * 1000));

                    // Re-authenticate in case token expired during wait
                    this._loggedIn = false;
                    await this.ensureLoggedIn();
                    continue;
                }
                throw err; // Non-rate-limit error or exhausted retries
            }
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
                })
                // Drop entries whose number didn't sanitize to a real dialable number
                // (blank / punctuation-only RC records collapse to the bare "+"), which
                // would otherwise poison defaultPhoneNumber and break line verification
                // with "No authentication key found for +".
                .filter(item => isLikelyValidPhone(item.phoneNumber));

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
