const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const { admin, db } = require("../../firebaseAdmin");
const { enqueueWorker } = require("../services/queueService");
const { setupSender } = require("./senderSetup");
const { runSendLoop } = require("./sendLoop");

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
        const senderId = sessionData.createdBy;
        const setup = await setupSender({ companyId, sessionRef, config, senderId });
        if (setup.failed) {
            return res.status(200).send(setup.failed);
        }
        const { adapter, emailTransporter } = setup;


        // --- SEQUENTIAL LOOP ---
        console.log(`[BatchWorker] Starting batch for Session ${sessionId}: ${batchIds.length} items`);
        const loopResult = await runSendLoop({
            batchIds,
            sessionRef,
            sessionId,
            companyId,
            sessionData,
            leadSourceType,
            config,
            companyName,
            senderId,
            adapter,
            emailTransporter,
        });
        batchSuccessCount = loopResult.batchSuccessCount;
        batchFailCount = loopResult.batchFailCount;
        pointerAdvanceCount += loopResult.pointerAdvanceCount;

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
