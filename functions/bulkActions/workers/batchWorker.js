const { onRequest } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");
const nodemailer = require("nodemailer");
const { enqueueWorker } = require("../services/queueService");
const { isBlacklisted } = require("../../blacklist");
const SMSAdapterFactory = require("../../integrations/factory");
const { decrypt } = require("../../integrations/encryption");

const delay = ms => new Promise(res => setTimeout(res, ms));

exports.processBulkBatch = onRequest({ timeoutSeconds: 540, memory: '512MiB' }, async (req, res) => {
    // --- SECURITY GATE: Shared Secret Verification ---
    // Reject requests that don't carry the internal auth header.
    // This prevents external actors from triggering the worker even if they know the URL.
    const workerSecret = process.env.BULK_WORKER_SECRET;
    if (!workerSecret) {
        console.error("[processBulkBatch] CRITICAL: BULK_WORKER_SECRET env var is not set. Rejecting all requests for safety.");
        return res.status(500).send("Server misconfiguration.");
    }

    const incomingSecret = req.headers['x-safehaul-internal-auth'];
    if (!incomingSecret || incomingSecret !== workerSecret) {
        console.warn("[processBulkBatch] Unauthorized request blocked. Missing or invalid internal auth header.");
        return res.status(403).send("Forbidden");
    }

    const { companyId, sessionId } = req.body;

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
        const { status, targetIds, progress, config, leadSourceType } = sessionData;

        // 1. Status Check
        if (status !== 'active') {
            return res.status(200).send(`Session is ${status}. Stopping worker.`);
        }

        // 1. Claim Batch Transactionally
        let batchIds = [];
        let startPointer = 0;
        let endPointer = 0;

        try {
            const claimResult = await db.runTransaction(async (t) => {
                const doc = await t.get(sessionRef);
                if (!doc.exists) throw new Error("Session not found");

                const data = doc.data();
                // Re-check status inside transaction
                if (data.status !== 'active') return null;

                const current = data.progress?.currentPointer || 0;
                const total = data.targetIds?.length || 0;

                if (current >= total) return { finished: true };

                const BATCH_SIZE = 50;
                const next = Math.min(current + BATCH_SIZE, total);

                // CLAIM: Advance the pointer immediately
                t.update(sessionRef, {
                    'progress.currentPointer': next,
                    lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
                });

                return {
                    start: current,
                    end: next,
                    allIds: data.targetIds,
                    sessionData: data // pass data out to avoid re-reading
                };
            });

            if (!claimResult) return res.status(200).send("Session not active (check logs).");
            if (claimResult.finished) {
                // Mark completed if not already?
                // Actually, if we are here, current >= total.
                await sessionRef.update({ status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp() });
                return res.status(200).send("Session already completed.");
            }

            batchIds = claimResult.allIds.slice(claimResult.start, claimResult.end);
            startPointer = claimResult.start;
            endPointer = claimResult.end;

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
        let senderId = sessionData.createdBy;

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
                console.error("Failed to load SMS Adapter:", e);
                // Fail the whole batch? Or just default?
                // If we can't send, we should fail.
            }
        } else if (config.method === 'email') {
            // Setup Nodemailer
            try {
                const emailSettingsDoc = await db.collection('companies').doc(companyId).collection('integrations').doc('email_settings').get();
                if (emailSettingsDoc.exists) {
                    const emailSettings = emailSettingsDoc.data();
                    let mailPass = emailSettings.password;

                    try {
                        if (mailPass && mailPass.includes(':')) { // Simple heuristic
                            const decrypted = decrypt(mailPass);
                            if (decrypted) mailPass = decrypted;
                        }
                    } catch (decErr) {/* ignore */ }

                    emailTransporter = nodemailer.createTransport({
                        service: 'gmail', // Simplification, should support others based on config
                        auth: { user: emailSettings.email, pass: mailPass }
                    });
                }
            } catch (e) { console.error("Failed to load Email Transporter:", e); }
        }



        // --- SEQUENTIAL LOOP ---
        console.log(`[BatchWorker] DEBUG: Starting batch for Session ${sessionId}`);
        console.log(`[BatchWorker] DEBUG: targetIds total: ${targetIds.length}`);
        console.log(`[BatchWorker] DEBUG: batchIds size: ${batchIds.length}`);
        console.log(`[BatchWorker] DEBUG: batchIds content:`, JSON.stringify(batchIds));

        try {

            for (let i = 0; i < batchIds.length; i++) {
                const leadId = batchIds[i];
                console.log(`[BatchWorker] DEBUG: Processing item ${i + 1}/${batchIds.length}: ${leadId}`);

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
                        continue; // Already processed
                    }

                    // 1. Fetch Data
                    if (leadSourceType === 'import') {
                        const tSnap = await sessionRef.collection('targets').doc(leadId).get();
                        if (tSnap.exists) leadData = tSnap.data();
                        else errorMsg = "Imported target data missing";
                    } else {
                        if (leadSourceType === 'global') {
                            leadDocRef = db.collection('leads').doc(leadId);
                        } else if (leadSourceType === 'leads') {
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

                // 3. Log Result
                try {
                    await sessionRef.collection('logs').doc(leadId).set({
                        leadId,
                        recipientName,
                        recipientIdentity,
                        status: success ? 'delivered' : 'failed',
                        error: errorMsg,
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        isSuccess: success
                    });
                } catch (e) { console.error("Failed to write log:", e); }

                if (success) batchSuccessCount++;
                else batchFailCount++;

                // 4.5 Update Lead Timestamp (Smart Exclusion)
                if (success && leadDocRef) {
                    leadDocRef.update({
                        lastBulkMessageAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastContactedAt: admin.firestore.FieldValue.serverTimestamp()
                    }).catch(() => { });
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

        const isKnownLast = (endPointer >= targetIds.length);

        await sessionRef.update({
            status: isKnownLast ? 'completed' : 'active',
            'progress.processedCount': admin.firestore.FieldValue.increment(batchSuccessCount + batchFailCount), // Explicitly sum processed
            'progress.successCount': admin.firestore.FieldValue.increment(batchSuccessCount),
            'progress.failedCount': admin.firestore.FieldValue.increment(batchFailCount),
            lastUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(isKnownLast ? { completedAt: admin.firestore.FieldValue.serverTimestamp() } : {})
        });

        // Loop next batch
        if (!isKnownLast) {
            await enqueueWorker(companyId, sessionId, 1);
        }

        res.status(200).send(`Processed partial batch. Success: ${batchSuccessCount}, Fail: ${batchFailCount}`);

    } catch (error) {
        console.error("[processBulkBatch] Critical Error:", error);

        // Attempt to save progress before dying
        try {
            await db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId).update({
                'progress.processedCount': admin.firestore.FieldValue.increment(batchSuccessCount + batchFailCount),
                'progress.successCount': admin.firestore.FieldValue.increment(batchSuccessCount),
                'progress.failedCount': admin.firestore.FieldValue.increment(batchFailCount),
            });
        } catch (e) { /* best effort */ }

        res.status(500).send(error.message);
    }
});
