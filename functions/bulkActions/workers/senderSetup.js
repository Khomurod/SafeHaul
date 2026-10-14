// functions/bulkActions/workers/senderSetup.js
//
// Builds the sender a batch will use: the per-line SMS adapter (which
// decrypts provider credentials, so SMS_ENCRYPTION_KEY must be bound on the
// CALLING function's options — see the comment above processBulkBatch), or
// the company's SMTP transporter, whose stored password may be encrypted too.
// Extracted from `batchWorker.js`. The adapter-failure branch used to send the
// HTTP response directly; it now marks the session failed exactly as before
// and returns `{ failed }` for the worker to send.

const { admin } = require("../../firebaseAdmin");
const nodemailer = require("nodemailer");
const SMSAdapterFactory = require("../../integrations/factory");
const { readSmtpSettings, smtpTransportOptions } = require("../../shared/smtpSettings");

/** Returns `{ adapter, emailTransporter, failed }`; `failed` is a message when the session was marked failed. */
async function setupSender({ companyId, sessionRef, config, senderId }) {
    let adapter = null;
    let emailTransporter = null;

        if (config.method === 'sms') {
            try {
                // Use factory to get appropriate adapter (accounts for per-line credentials/JWTs)
                adapter = await SMSAdapterFactory.getAdapterForUser(companyId, senderId);
                // Pre-authenticate once for the entire batch (avoids per-message login rate limits)
                if (adapter.ensureLoggedIn) {
                    await adapter.ensureLoggedIn();
                    console.log('[BatchWorker] SMS adapter pre-authenticated successfully.');
                }
            } catch (e) {
                // AUDIT FIX #1: If adapter can't load, fail the session immediately
                // instead of looping through all items and failing each one individually.
                console.error("Failed to load SMS Adapter — marking session as failed:", e);
                await sessionRef.update({
                    status: 'failed',
                    error: `SMS adapter initialization failed: ${e.message}`,
                    failedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                return { adapter: null, emailTransporter: null, failed: `SMS adapter failed to initialize: ${e.message}. Session marked as failed.` };
            }
        } else if (config.method === 'email') {
            // The company's settings, read as its own emails read them (shared/smtpSettings.js).
            // A setup that cannot be read leaves no transporter, and each email fails as "Email Settings Invalid".
            try {
                const { settings } = await readSmtpSettings(companyId);
                if (settings) emailTransporter = nodemailer.createTransport(smtpTransportOptions(settings));
            } catch (e) { console.error("Failed to load Email Transporter:", e); }
        }

    return { adapter, emailTransporter, failed: null };
}

module.exports = { setupSender };
