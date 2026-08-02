const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const { admin, db } = require("../../firebaseAdmin");
const nodemailer = require("nodemailer");
const { enqueueWorker } = require("../services/queueService");
const { isBlacklisted } = require("../../blacklist");
const SMSAdapterFactory = require("../../integrations/factory");
const { decrypt } = require("../../integrations/encryption");
const { normalizePhone } = require("../../utils/phoneUtils");

const delay = ms => new Promise(res => setTimeout(res, ms));

// B4: hard per-session lifetime ceiling — a runaway-cost circuit breaker so a single
// bulk_session can never process more than this many items total, regardless of how large
// (or corrupted) its targetIds list is. Set far above any legitimate campaign; tunable via env.
const MAX_SESSION_SENDS = Number(process.env.BULK_SESSION_MAX_SENDS) || 100000;

// SMS_ENCRYPTION_KEY: this worker decrypts the company's SMS provider credentials /
// per-line JWTs (via SMSAdapterFactory) and SMTP passwords for bulk campaigns. Without the
// secret bound here, process.env.SMS_ENCRYPTION_KEY is undefined inside this function and
// every decrypt throws "SMS_ENCRYPTION_KEY ... is not set", so the adapter fails to load and
// the whole campaign session is marked failed -- i.e. campaigns silently don't send even when
// the line is correctly provisioned (the config/test-send functions DO bind the secret, which
// is why Super Admin shows the line as working while bulk sends fail).
exports.processBulkBatch = onRequest({
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: ['SMS_ENCRYPTION_KEY', 'BULK_WORKER_SECRET', 'PROCESS_BULK_BATCH_URL'],
}, async (req, res) => {
    // --- SECURITY GATE: Shared Secret Verification ---
    // Reject requests that don't carry the internal auth header.
    // This prevents external actors from triggering the worker even if they know the URL.
    const workerSecret = process.env.BULK_WORKER_SECRET;
    if (!workerSecret) {
        console.error("[processBulkBatch] CRITICAL: BULK_WORKER_SECRET env var is not set. Rejecting all requests for safety.");
        return res.status(500).send("Server misconfiguration.");
    }

    // Constant-time comparison so the shared secret can't be recovered via a
    // timing side-channel (consistent with publicSigning.js safeCompare).
    const incomingBuf = Buffer.from(String(req.headers['x-safehaul-internal-auth'] || ''));
    const expectedBuf = Buffer.from(String(workerSecret));
    const secretOk = incomingBuf.length === expectedBuf.length
        && crypto.timingSafeEqual(incomingBuf, expectedBuf);
    if (!secretOk) {
        console.warn("[processBulkBatch] Unauthorized request blocked. Missing or invalid internal auth header.");
        return res.status(403).send("Forbidden");
    }

    const { companyId, sessionId, workerGeneration } = req.body;

    if (!companyId || !sessionId) {
        return res.status(400).send("Missing companyId or sessionId");
    }

    let batchSuccessCount = 0;
    let batchFailCount = 0;

    try {
        const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);
        const sessionSnap = await sessionRef.get();

        if (!sessionSnap.exists) {
            return res.status(404).send("Session not found");
        }

        const sessionData = sessionSnap.data();
        const { status, config, leadSourceType } = sessionData;

        // 1. Status Check
        if (status !== 'active') {
            return res.status(200).send(`Session is ${status}. Stopping worker.`);
        }

        // 1b. AUDIT FIX #4: Stale Worker Generation Check
        // If workerGeneration was provided in the task payload, verify it matches
        // the current session. A mismatch means a newer Resume spawned a new worker
        // and this one is stale.
        if (typeof workerGeneration === 'number' && typeof sessionData.workerGeneration === 'number') {
            if (workerGeneration !== sessionData.workerGeneration) {
                console.log(`[processBulkBatch] Stale worker detected: payload gen=${workerGeneration}, session gen=${sessionData.workerGeneration}. Exiting.`);
                return res.status(200).send('Stale worker generation. Exiting gracefully.');
            }
        }

        // 1. Claim Batch Range (without advancing pointer yet)
        let batchIds = [];
        let claimedStartPointer = 0;
        let claimedEndPointer = 0;
        let pointerAdvanceCount = 0;

        try {
            const claimResult = await db.runTransaction(async (t) => {
                const doc = await t.get(sessionRef);
                if (!doc.exists) throw new Error("Session not found");

                const data = doc.data();
                // Re-check status inside transaction
                if (data.status !== 'active') return null;

                const current = data.progress?.currentPointer || 0;
                const total = data.targetIds?.length || 0;

                // B4: circuit breaker — halt before claiming another batch if this session
                // has already processed an unreasonable number of items.
                if (current >= MAX_SESSION_SENDS) return { ceilingExceeded: true };

                if (current >= total) return { finished: true };

                const BATCH_SIZE = 50;
                const next = Math.min(current + BATCH_SIZE, total);

                return {
                    start: current,
                    end: next,
                    allIds: data.targetIds,
                    sessionData: data // pass data out to avoid re-reading
                };
            });

            if (!claimResult) return res.status(200).send("Session not active (check logs).");
            if (claimResult.ceilingExceeded) {
                // B4: stop the recursion entirely and surface why; do NOT enqueue another worker.
                console.error(`[processBulkBatch] Session ${sessionId} hit the ${MAX_SESSION_SENDS}-send ceiling. Halting.`);
                await sessionRef.update({
                    status: 'failed',
                    error: `Session exceeded the ${MAX_SESSION_SENDS}-send safety ceiling and was halted.`,
                    failedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                return res.status(200).send("Session exceeded max-send ceiling. Halted.");
            }
            if (claimResult.finished) {
                // Mark completed if not already?
                // Actually, if we are here, current >= total.
                await sessionRef.update({ status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp() });
                return res.status(200).send("Session already completed.");
            }

            batchIds = claimResult.allIds.slice(claimResult.start, claimResult.end);
            claimedStartPointer = claimResult.start;
            claimedEndPointer = claimResult.end;

            // Use the data we already fetched
            // sessionData variable in outer scope is not used much below, except for config/leadSourceType
            // Let's update the outer scope variables if needed or just use what we returned.
            // But we can't easily update 'const' variables from outer scope if we don't change them to let.
            // The code below uses `sessionData` which was defined at line 28.
            // We should update `sessionData` to use the fresh one from transaction to be safe? 
            // Actually, line 28 `sessionData` is from `sessionSnap` before transaction.
            // That's fine for `config` and `leadSourceType` (immutable mostly).
            // But `progress` is mutable.
            // However, we just used the transaction to determine the batch.
            // The rest of the logic relies on `batchIds`.

        } catch (e) {
            console.error("Batch Claim Transaction Failed:", e);
            throw e;
        }
        // console.log(`[Batch Worker] Processing ${batchIds.length} items (${currentPointer} - ${endPointer}) for session ${sessionId}`);

        // --- PRELOAD RESOURCES ---
        const companySnap = await db.collection('companies').doc(companyId).get();
        const companyName = companySnap.exists ? companySnap.data().name : "SafeHaul Company";

        // Setup Sender (SMS or Email)
        let adapter = null;
        let emailTransporter = null;
        const senderId = sessionData.createdBy;

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
                return res.status(200).send(`SMS adapter failed to initialize: ${e.message}. Session marked as failed.`);
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



        // --- SEQUENTIAL LOOP ---
        console.log(`[BatchWorker] Starting batch for Session ${sessionId}: ${batchIds.length} items`);

        try {

            for (let i = 0; i < batchIds.length; i++) {
                const leadId = batchIds[i];
                // Note: Lead ID not logged to avoid exposing PII in Cloud Function logs

                // Status check before every send (including first) so pause/cancel
                // cannot slip a message through on batch start.
                try {
                    const midCheck = await sessionRef.get();
                    if (!midCheck.exists || !['active'].includes(midCheck.data().status)) {
                        console.log(`[BatchWorker] Mid-batch cancel detected at item ${i}/${batchIds.length}. Breaking.`);
                        break;
                    }
                } catch (checkErr) {
                    console.warn('[BatchWorker] Mid-batch status check failed (continuing):', checkErr.message);
                }

                const loopStart = Date.now();
                let success = false;
                let errorMsg = null;
                let recipientName = "Unknown";
                let recipientIdentity = "N/A";

                // Declare variables in loop scope
                let leadData = {};
                let leadDocRef = null;

                try {
                    // Idempotency Check
                    const logRef = sessionRef.collection('logs').doc(leadId);
                    const logSnap = await logRef.get();
                    if (logSnap.exists) {
                        await sessionRef.update({
                            'progress.currentPointer': admin.firestore.FieldValue.increment(1),
                            lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                        pointerAdvanceCount++;
                        continue; // Already processed
                    }

                    // 1. Fetch Data
                    if (leadSourceType === 'import') {
                        // AUDIT FIX #3: For retries, target docs live under the ORIGINAL session
                        const sourceSessionId = sessionData.importSourceSessionId || sessionId;
                        const tSnap = await db.collection('companies').doc(companyId)
                            .collection('bulk_sessions').doc(sourceSessionId)
                            .collection('targets').doc(leadId).get();
                        
                        if (tSnap.exists) leadData = tSnap.data();
                        else errorMsg = "Imported target data missing";
                    } else {
                        if (leadSourceType === 'leads') {
                            leadDocRef = db.collection('companies').doc(companyId).collection('leads').doc(leadId);
                        } else {
                            leadDocRef = db.collection('companies').doc(companyId).collection('applications').doc(leadId);
                        }
                        const lSnap = await leadDocRef.get();
                        if (lSnap.exists) leadData = lSnap.data();
                        else errorMsg = "CRM lead data missing";
                    }


                    if (!errorMsg) {
                        recipientName = `${leadData.firstName || 'Driver'} ${leadData.lastName || ''}`.trim();
                        const phone = leadData.phone || leadData.phoneNumber;

                        // 2. Blacklist Check
                        const blacklisted = await isBlacklisted(companyId, phone);

                        if (blacklisted) {
                            errorMsg = "Number is blacklisted (Opt-out)";
                            success = false;
                        } else if (config.method === 'sms') {
                            if (!adapter) throw new Error("SMS Configuration Invalid");
                            recipientIdentity = phone || "No Phone";

                            if (recipientIdentity !== "No Phone") {
                                const finalMsg = config.message
                                    .replace(/\[Driver Name\]/g, leadData.firstName || 'Driver')
                                    .replace(/\[Company Name\]/g, companyName)
                                    .replace(/\[Recruiter Name\]/g, config.recruiterName || 'your recruiter');

                                await adapter.sendSMS(recipientIdentity, finalMsg, senderId);
                                success = true;
                            } else {
                                errorMsg = "No valid phone number";
                            }
                        } else if (config.method === 'email') {
                            if (!emailTransporter) throw new Error("Email Settings Invalid");
                            recipientIdentity = leadData.email || "No Email";

                            if (recipientIdentity !== "No Email") {
                                const finalBody = config.message
                                    .replace(/\[Driver Name\]/g, leadData.firstName || 'Driver')
                                    .replace(/\[Company Name\]/g, companyName)
                                    .replace(/\[Recruiter Name\]/g, config.recruiterName || 'your recruiter');

                                await emailTransporter.sendMail({
                                    from: `"${companyName}" <${emailTransporter.transporter.options.auth.user}>`,
                                    to: recipientIdentity,
                                    subject: config.subject || `Update from ${companyName}`,
                                    text: finalBody,
                                    html: `<p>${finalBody.replace(/\n/g, '<br>')}</p>`
                                });
                                success = true;
                            } else {
                                errorMsg = "No valid email";
                            }
                        }
                    }

                } catch (err) {
                    console.error(`Error processing lead ${leadId}:`, err);
                    errorMsg = err.message || "Unknown error";
                    success = false;
                }

                // 3. Log result + advance pointer atomically so pause/cancel never skips work.
                const logPayload = {
                    leadId,
                    recipientName,
                    recipientIdentity,
                    status: success ? 'delivered' : 'failed',
                    error: errorMsg,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    isSuccess: success
                };
                try {
                    const applied = await db.runTransaction(async (t) => {
                        const logRef = sessionRef.collection('logs').doc(leadId);
                        const [sessionDoc, logDoc] = await Promise.all([
                            t.get(sessionRef),
                            t.get(logRef)
                        ]);
                        if (!sessionDoc.exists) return { alreadyLogged: false };

                        const updates = {
                            'progress.currentPointer': admin.firestore.FieldValue.increment(1),
                            lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
                        };

                        if (logDoc.exists) {
                            t.update(sessionRef, updates);
                            return { alreadyLogged: true };
                        }

                        t.set(logRef, logPayload);
                        t.update(sessionRef, {
                            ...updates,
                            'progress.processedCount': admin.firestore.FieldValue.increment(1),
                            'progress.successCount': admin.firestore.FieldValue.increment(success ? 1 : 0),
                            'progress.failedCount': admin.firestore.FieldValue.increment(success ? 0 : 1),
                        });
                        return { alreadyLogged: false };
                    });

                    if (!applied?.alreadyLogged) {
                        if (success) batchSuccessCount++;
                        else batchFailCount++;
                    }
                    pointerAdvanceCount++;
                } catch (e) {
                    console.error("Failed to write log + progress transaction:", e);
                }

                // 4.5 Update Lead Timestamp (Smart Exclusion)
                // AUDIT FIX #7: Log errors instead of silently swallowing them
                if (success && leadDocRef) {
                    leadDocRef.update({
                        lastBulkMessageAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastContactedAt: admin.firestore.FieldValue.serverTimestamp()
                    }).catch(e => {
                        console.error(`[BatchWorker] Failed to update lead timestamp for ${leadId}:`, e.message);
                    });
                }

                // 4.6 Update Send Ledgers (7-Day Dedup) for SMS *and* Email
                // AUDIT FIX #7 / BUG-8: Log errors to detect dedup gaps. Email now
                // mirrors the SMS ledger so `sessionController` can skip recently
                // contacted addresses in BOTH channels.
                if (success && config.method === 'sms') {
                    const normPhone = normalizePhone(recipientIdentity);
                    if (normPhone) {
                        db.collection('companies').doc(companyId)
                            .collection('sms_sent_phones').doc(normPhone)
                            .set({
                                lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
                                sessionId: sessionId
                            }, { merge: true })
                            .catch(e => {
                                console.error(`[BatchWorker] Failed to update sms_sent_phones for ${normPhone}:`, e.message);
                            });
                    }
                } else if (success && config.method === 'email') {
                    const normEmail = String(recipientIdentity || '').trim().toLowerCase();
                    // Doc IDs cannot contain "/" — Base64 the email to keep it path-safe.
                    if (normEmail && normEmail.includes('@')) {
                        const docId = Buffer.from(normEmail, 'utf8').toString('base64')
                            .replace(/=+$/, '')
                            .replace(/\//g, '_')
                            .replace(/\+/g, '-');
                        db.collection('companies').doc(companyId)
                            .collection('email_sent_addresses').doc(docId)
                            .set({
                                email: normEmail,
                                lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
                                sessionId: sessionId
                            }, { merge: true })
                            .catch(e => {
                                console.error(`[BatchWorker] Failed to update email_sent_addresses for ${normEmail}:`, e.message);
                            });
                    }
                }

                // 5. Safety Delay (3s requirement)
                const elapsed = Date.now() - loopStart;
                const waitTime = Math.max(3000 - elapsed, 100);
                await delay(waitTime);
            }
        } catch (loopError) {
            console.error("Critical Loop Error:", loopError);
            // Fallthrough to save progress
        }

        // --- END BATCH UPDATE ---
        // Ensure we save whatever progress we made, even if we crashed/stopped early
        const freshSnap = await sessionRef.get();
        if (!freshSnap.exists || ['cancelled', 'paused'].includes(freshSnap.data().status)) {
            return res.status(200).send("Session stopped mid-batch.");
        }

        const postBatchSnap = await sessionRef.get();
        if (!postBatchSnap.exists) {
            return res.status(200).send("Session removed mid-batch.");
        }
        const postBatch = postBatchSnap.data();
        const persistedPointer = postBatch.progress?.currentPointer || 0;
        const currentPointer = Math.max(persistedPointer, claimedStartPointer + pointerAdvanceCount);
        const totalTargets = postBatch.targetIds?.length || 0;
        const isKnownLast = (currentPointer >= totalTargets);

        if (isKnownLast && postBatch.status === 'active') {
            await sessionRef.update({
                status: 'completed',
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // Loop next batch while active and not complete
        if (!isKnownLast && postBatch.status === 'active') {
            // AUDIT FIX #4: Forward workerGeneration so next batch can verify it
            await enqueueWorker(companyId, sessionId, 1, workerGeneration);
        }

        res.status(200).send(`Processed batch window up to ${claimedEndPointer}. Success: ${batchSuccessCount}, Fail: ${batchFailCount}`);

    } catch (error) {
        console.error("[processBulkBatch] Critical Error:", error);

        // Attempt to save progress before dying
        try {
            await db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId).update({
                lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) { /* best effort */ }

        res.status(500).send(error.message);
    }
});
