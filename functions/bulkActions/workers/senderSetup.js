// functions/bulkActions/workers/senderSetup.js
//
// Builds the sender a batch will use: the per-line SMS adapter (which
// decrypts provider credentials, so SMS_ENCRYPTION_KEY must be bound on the
// CALLING function's options — see the comment above processBulkBatch), or
// the company's SMTP transporter. Extracted verbatim from `batchWorker.js`
// except the one seam: the adapter-failure branch used to send the HTTP
// response directly; it now marks the session failed exactly as before and
// returns `{ failed }` for the worker to send.

const { db } = require("../../firebaseAdmin");
const { admin } = require("../../firebaseAdmin");
const nodemailer = require("nodemailer");
const SMSAdapterFactory = require("../../integrations/factory");
const { decrypt } = require("../../integrations/encryption");

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
            // Setup Nodemailer
            try {
                let emailSettingsDoc = await db.collection('companies')
                    .doc(companyId)
                    .collection('system_settings')
                    .doc('email_config')
                    .get();

                // Backward compatibility for pre-migration settings location.
                if (!emailSettingsDoc.exists) {
                    emailSettingsDoc = await db.collection('companies').doc(companyId).collection('integrations').doc('email_settings').get();
                }
                if (emailSettingsDoc.exists) {
                    const emailSettings = emailSettingsDoc.data();
                    let mailPass = emailSettings.smtpPass || emailSettings.password;

                    // CONN-12 FIX: Use versioned prefix check instead of fragile `includes(':')` heuristic.
                    // The old `if (password.includes(':'))` would accidentally trigger decryption on any
                    // plain-text password containing a colon (e.g. a date or URL), causing auth failures.
                    try {
                        if (mailPass && mailPass.startsWith('enc:v1:')) {
                            const decrypted = decrypt(mailPass.slice('enc:v1:'.length));
                            if (decrypted) mailPass = decrypted;
                        }
                    } catch (decErr) {
                        console.error('[BatchWorker] Failed to decrypt email password:', decErr.message);
                        /* Use the raw value — will fail on SMTP auth which is a visible error */
                    }

                    const transportConfig = {};
                    if (emailSettings.smtpHost || emailSettings.host) {
                        // Custom SMTP (Outlook, SendGrid, Office 365, etc.)
                        transportConfig.host = emailSettings.smtpHost || emailSettings.host;
                        transportConfig.port = emailSettings.smtpPort || emailSettings.port || 587;
                        transportConfig.secure = emailSettings.secure || false;
                    } else {
                        // Fallback to Gmail for backward compatibility
                        transportConfig.service = 'gmail';
                    }
                    transportConfig.auth = { user: emailSettings.smtpUser || emailSettings.email, pass: mailPass };
                    emailTransporter = nodemailer.createTransport(transportConfig);
                }
            } catch (e) { console.error("Failed to load Email Transporter:", e); }
        }

    return { adapter, emailTransporter, failed: null };
}

module.exports = { setupSender };
