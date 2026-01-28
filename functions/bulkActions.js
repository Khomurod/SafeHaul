const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("./firebaseAdmin");
const SMSAdapterFactory = require("./integrations/factory");
const { CloudTasksClient } = require("@google-cloud/tasks");
const nodemailer = require('nodemailer');
const { isBlacklisted } = require("./blacklist");

// --- CONSTANTS (Synced with Frontend) ---
const APPLICATION_STATUSES = [
    { id: 'new', label: 'New Application', value: 'New Application' },
    { id: 'contacted', label: 'Contacted', value: 'Contacted' },
    { id: 'interview', label: 'Interview Scheduled', value: 'Interview Scheduled' },
    { id: 'offer', label: 'Offer Sent', value: 'Offer Sent' },
    { id: 'hired', label: 'Hired', value: 'Hired' },
    { id: 'rejected', label: 'Rejected', value: 'Rejected' },
    { id: 'withdrawn', label: 'Withdrawn', value: 'Withdrawn' },
    { id: 'inactive', label: 'Inactive (30d+)', value: 'Inactive' }
];

const LAST_CALL_RESULTS = [
    { id: 'no_answer', label: 'No Answer', value: 'No Answer' },
    { id: 'left_voicemail', label: 'Left Voicemail', value: 'Left Voicemail' },
    { id: 'busy', label: 'Busy', value: 'Busy' },
    { id: 'wrong_number', label: 'Wrong Number', value: 'Wrong Number' },
    { id: 'not_interested', label: 'Not Interested', value: 'Not Interested' }
];

const getDbValue = (id, dictionary) => {
    const item = dictionary.find(i => i.id === id);
    return item ? item.value : id;
};

const PROJECT_ID = admin.instanceId().app.options.projectId || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;

// Allow region to be configured, default to us-central1 if not set
const LOCATION = process.env.FUNCTION_REGION || process.env.GCP_REGION || 'us-central1';
const QUEUE_NAME = "bulk-actions-queue";
const TASKS_CLIENT_OPTS = {};
// Initialize client with fallback if needed, but usually default is fine in Cloud Functions
const tasksClient = new CloudTasksClient(TASKS_CLIENT_OPTS);

/**
 * 1. Initialize a Bulk Messaging Session
 * Handles filtering and identifying target IDs across 3 sources.
 */
exports.initBulkSession = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    const { companyId, filters, messageConfig, scheduledFor, name } = request.data;
    const userId = request.auth.uid;

    if (!companyId || !filters || !messageConfig) {
        throw new HttpsError('invalid-argument', 'Missing companyId, filters, or messageConfig.');
    }

    try {
        console.log(`[initBulkSession] Initializing session. Project: ${PROJECT_ID}, Region: ${LOCATION}`);

        // --- 0. FETCH RECRUITER & COMPANY NAMES (Phase 7) ---
        let recruiterName = "Recruiter";
        let companyName = "SafeHaul";

        const userSnap = await db.collection('users').doc(userId).get();
        if (userSnap.exists) recruiterName = userSnap.data().name || recruiterName;

        const companySnap = await db.collection('companies').doc(companyId).get();
        if (companySnap.exists) companyName = companySnap.data().companyName || companyName;
        // --- 1. RESOLVE SOURCE ---
        let targetIds = [];
        if (filters.segmentId && filters.segmentId !== 'all') {
            const segmentSnap = await db.collection('companies').doc(companyId)
                .collection('segments').doc(filters.segmentId)
                .collection('members').limit(200).get();
            targetIds = segmentSnap.docs.map(d => d.id);
        } else {
            let baseRef;
            if (filters.leadType === 'global') {
                baseRef = db.collection('leads');
            } else if (filters.leadType === 'leads') {
                // Assigned SafeHaul Leads (And Imported Leads) - RELAXED FILTER
                baseRef = db.collection('companies').doc(companyId).collection('leads');
            } else {
                // Direct Company Applications
                baseRef = db.collection('companies').doc(companyId).collection('applications');
            }

            let q = baseRef;

            // --- 2. APPLY FILTERS ---
            // Status Filter
            if (filters.status && filters.status.length > 0 && filters.status !== 'all') {
                // Map IDs to DB Values
                const mapStatus = (s) => getDbValue(s, APPLICATION_STATUSES);

                // Support for single status or multi-status array calling
                if (Array.isArray(filters.status)) {
                    const dbStatuses = filters.status.map(mapStatus);
                    q = q.where('status', 'in', dbStatuses);
                } else {
                    const dbStatus = mapStatus(filters.status);
                    q = q.where('status', '==', dbStatus);
                }
            }

            // Recruiter Filter
            if (filters.recruiterId === 'my_leads') {
                q = q.where('assignedTo', '==', userId);
            } else if (filters.recruiterId && filters.recruiterId !== 'all') {
                q = q.where('assignedTo', '==', filters.recruiterId);
            }

            // Created Date Range Filters
            if (filters.createdAfter) {
                const date = new Date(filters.createdAfter);
                q = q.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(date));
            }
            if (filters.createdBefore) {
                const date = new Date(filters.createdBefore);
                q = q.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(date));
            }

            // Note: 'notContactedSince' requires a field on the document.
            // We use Filter.or to include leads that have lastContactedAt <= date OR lastContactedAt == null (if explicitly set).
            // WARNING: Leads with the field strictly MISSING (undefined) will still be excluded by Firestore indexing rules.
            if (filters.notContactedSince) {
                const days = parseInt(filters.notContactedSince);
                const date = new Date();
                date.setDate(date.getDate() - days);
                const threshold = admin.firestore.Timestamp.fromDate(date);

                q = q.where(admin.firestore.Filter.or(
                    admin.firestore.Filter.where('lastContactedAt', '<=', threshold),
                    admin.firestore.Filter.where('lastContactedAt', '==', null)
                ));
            }

            // Last Call Outcome Filter (Phase 6 & 8)
            if (filters.lastCallOutcome && filters.lastCallOutcome !== 'all') {
                if (filters.leadType === 'global') {
                    // Map Label -> ID for Global Pool
                    const outcomeMap = {
                        "Connected / Interested": "interested",
                        "Connected / Scheduled Callback": "callback",
                        "Connected / Not Qualified": "not_qualified",
                        "Connected / Not Interested": "not_interested",
                        "Connected / Hired Elsewhere": "hired_elsewhere",
                        "Left Voicemail": "voicemail",
                        "No Answer": "no_answer",
                        "Wrong Number": "wrong_number"
                    };
                    const outcomeId = outcomeMap[filters.lastCallOutcome];
                    if (outcomeId) {
                        q = q.where('lastOutcome', '==', outcomeId);
                    } else {
                        // Fallback to literal if mapping fails
                        q = q.where('lastOutcome', '==', filters.lastCallOutcome);
                    }
                } else {
                    // Map ID -> DB Value for Company Leads
                    const dbOutcome = getDbValue(filters.lastCallOutcome, LAST_CALL_RESULTS);
                    q = q.where('lastCallOutcome', '==', dbOutcome);
                }
            }

            // --- 3. EXECUTE QUERY ---
            // CRITICAL FIX: Ignore frontend preview limit (50). Use a high cap for execution.
            const limitCount = 5000; // Increased from 200 to 5000 for true bulk actions
            const snapshot = await q.limit(limitCount).get();
            targetIds = snapshot.docs.map(doc => doc.id);
        }

        // Filter: Exclude Session IDs
        // This must be done in memory after fetching or by fetching the previous sessions first.
        // Memory filter is easiest for < 500 items. 
        if (filters.excludeSessionIds && filters.excludeSessionIds.length > 0) {
            // Fetch target IDs from those sessions? Expensive.
            // Better: 'excludeLeadsFromSessions' -> fetch attempts? 
            // For now, let's skip complex exclusion logic to avoid read spikes unless explicitly requested with optimized schema.
        }

        // Filter: Manually Excluded Lead IDs (Opt-out from Preview)
        if (filters.excludedLeadIds && Array.isArray(filters.excludedLeadIds)) {
            targetIds = targetIds.filter(id => !filters.excludedLeadIds.includes(id));
        }

        if (targetIds.length === 0) {
            return { success: false, message: "No drivers found for these criteria." };
        }

        // --- 4. CREATE SESSION ---
        const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc();

        let initialStatus = 'queued';
        let scheduleTime = 0; // 0 means immediate

        if (scheduledFor) {
            const scheduleDate = new Date(scheduledFor);
            const now = new Date();
            if (scheduleDate > now) {
                initialStatus = 'scheduled';
                scheduleTime = (scheduleDate.getTime() - now.getTime()) / 1000;
            }
        }

        const sessionData = {
            id: sessionRef.id,
            companyId: companyId,
            name: name || "Untitled Campaign",
            status: initialStatus,
            creatorId: userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            scheduledFor: scheduledFor ? admin.firestore.Timestamp.fromDate(new Date(scheduledFor)) : null,
            config: {
                ...messageConfig,
                filters: filters,
                recruiterName,
                companyName
            },
            progress: {
                totalCount: targetIds.length,
                processedCount: 0,
                successCount: 0,
                failedCount: 0
            },
            targetIds: targetIds,
            currentPointer: 0,
            leadSourceType: filters.leadType // 'applications' | 'leads' | 'global'
        };

        await sessionRef.set(sessionData);

        // --- 5. START WORKER ---
        await enqueueWorker(companyId, sessionRef.id, scheduleTime);

        return {
            success: true,
            sessionId: sessionRef.id,
            targetCount: targetIds.length,
            status: initialStatus
        };

    } catch (error) {
        console.error("[initBulkSession] Error:", error);
        throw new HttpsError('internal', error.message);
    }
});

/**
 * Bulk session controls (pause/resume/cancel) have been refactored
 * to use direct Firestore SDK updates for better performance.
 * 
 * EXCEPTION: Resume requires a server-side kick to restart the worker.
 */
exports.resumeBulkSession = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    const { companyId, sessionId } = request.data;
    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);

    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found');

    const session = sessionSnap.data();
    if (session.status === 'completed') {
        return { success: false, message: 'Session already completed' };
    }

    // 1. Set status to active
    await sessionRef.update({
        status: 'active',
        resumedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 2. Kickstart the worker again (immediate)
    // We pass 0 delay to start processing immediately
    await enqueueWorker(companyId, sessionId, 0);

    return { success: true, message: 'Session resumed' };
});


/**
 * 5. Retry Failed Attempts
 * Creates a new session with only the failed IDs from a previous session.
 */
exports.retryFailedAttempts = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');
    const { companyId, originalSessionId, newMessageConfig } = request.data;
    const userId = request.auth.uid;

    try {
        // 1. Fetch failed logs
        const logsSnapshot = await db.collection('companies').doc(companyId)
            .collection('bulk_sessions').doc(originalSessionId)
            .collection('logs')
            .where('status', '==', 'failed')
            .get();

        // --- TRANSIENT ERROR FILTERING ---
        // Permanent errors that we should NOT retry automatically
        const permanentErrors = [
            "blacklist", "opt-out", "invalid", "landline", "no phone", "unreachable", "unallocated"
        ];

        const retryableLogs = logsSnapshot.docs.filter(doc => {
            const error = (doc.data().error || "").toLowerCase();
            return !permanentErrors.some(pe => error.includes(pe));
        });

        const failedLeadIds = [...new Set(retryableLogs.map(d => d.data().leadId))];

        if (failedLeadIds.length === 0) {
            return {
                success: false,
                message: "No transient failures found. All errors appear to be permanent (Invalid numbers, Blacklisted, etc)."
            };
        }

        // 2. Fetch original config if not provided
        let configToUse = newMessageConfig;
        if (!configToUse) {
            const originalSessionSnap = await db.collection('companies').doc(companyId)
                .collection('bulk_sessions').doc(originalSessionId)
                .get();
            configToUse = originalSessionSnap.data().config;
        }

        // 3. Create NEW Session
        const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc();
        const sessionData = {
            id: sessionRef.id,
            status: 'queued',
            creatorId: userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            config: configToUse,
            progress: {
                totalCount: failedLeadIds.length,
                processedCount: 0,
                successCount: 0,
                failedCount: 0
            },
            targetIds: failedLeadIds,
            currentPointer: 0,
            leadSourceType: 'retry',
            originalSessionId: originalSessionId
        };

        await sessionRef.set(sessionData);

        // 4. Start Worker
        await enqueueWorker(companyId, sessionRef.id, 0);

        return { success: true, sessionId: sessionRef.id, targetCount: failedLeadIds.length };

    } catch (error) {
        console.error("Retry Error:", error);
        throw new HttpsError('internal', error.message);
    }
});


/**
 * 2. Recursive Worker (Cloud Tasks Target)
 * Processes leads sequentially with carrier-compliant delays.
 */
/**
 * 2. Recursive Worker (Cloud Tasks Target)
 * Processes leads in BATCHES to improve throughput and reduce costs.
 * 
 * Recommended Batch Size: 50
 * - Reduces function invocations by 50x
 * - Keeps execution time well within 60s timeout (usually < 5s)
 * - stays under Firestore batch limit (500 ops)
 */
exports.processBulkBatch = onRequest({
    timeoutSeconds: 540,
    memory: '1GiB',
    region: 'us-central1',
    secrets: ['SMS_ENCRYPTION_KEY']
}, async (req, res) => {

    // Security check: Only allow Cloud Tasks to call this
    const hasQueueHeader = req.headers["x-appengine-queuename"] || req.headers["x-cloudtasks-queuename"];
    if (!hasQueueHeader && !process.env.FUNCTIONS_EMULATOR) {
        return res.status(403).send("Forbidden");
    }

    const { companyId, sessionId } = req.body;
    if (!companyId || !sessionId) return res.status(400).send("Missing parameters");

    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);

    try {
        const sessionSnap = await sessionRef.get();
        if (!sessionSnap.exists) return res.status(404).send("Session not found");

        const session = sessionSnap.data();
        if (session.status === 'paused' || session.status === 'completed') {
            return res.status(200).send("Session is not active.");
        }

        const { targetIds, currentPointer, config, progress, leadSourceType } = session;

        // Completion check
        if (currentPointer >= targetIds.length) {
            await sessionRef.update({
                status: 'completed',
                completedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return res.status(200).send("Campaign Complete");
        }

        // --- BATCH CONFIGURATION ---
        const BATCH_SIZE = 50;
        const endPointer = Math.min(currentPointer + BATCH_SIZE, targetIds.length);
        const batchIds = targetIds.slice(currentPointer, endPointer);

        console.log(`[Batch Worker] Processing ${batchIds.length} leads (Indices ${currentPointer} - ${endPointer - 1})`);

        // --- 1. PRELOAD DATA (Optimization) ---
        // Fetching 50 documents individually is slow. 
        // Better to use getAll() if possible, but they are in different subcollections?
        // If 'leadSourceType' is consistent, we can try to optimize, but parallel fetches are okay for 50.

        // Prepare shared resources
        let adapter = null;
        let emailTransporter = null;
        let companyName = config.companyName || 'SafeHaul';
        const senderId = session.creatorId;

        // Initialize Adapter / Transporter ONCE per batch
        if (config.method === 'sms') {
            try {
                adapter = await SMSAdapterFactory.getAdapterForUser(companyId, senderId);
            } catch (e) {
                console.error("Failed to initialize SMS adapter:", e);
                // If adapter fails, entire batch fails with "Configuration Error"
                // We'll handle this inside the loop to fail gracefully
            }
        } else if (config.method === 'email') {
            try {
                const companySnap = await db.collection('companies').doc(companyId).get();
                const emailSettings = companySnap.data()?.emailSettings;
                if (emailSettings?.email && emailSettings?.appPassword) {
                    emailTransporter = nodemailer.createTransport({
                        service: 'gmail',
                        auth: { user: emailSettings.email, pass: emailSettings.appPassword }
                    });
                }
            } catch (e) {
                console.error("Failed to initialize Email transport:", e);
            }
        }

        // --- 2. PROCESS BATCH (Parallel Execution) ---
        const results = await Promise.all(batchIds.map(async (leadId) => {
            let success = false;
            let errorMsg = null;
            let recipientName = "Unknown";
            let recipientIdentity = "N/A";

            try {
                // Fetch Lead
                let leadDocRef;
                if (leadSourceType === 'global') {
                    leadDocRef = db.collection('leads').doc(leadId);
                } else if (leadSourceType === 'leads') {
                    leadDocRef = db.collection('companies').doc(companyId).collection('leads').doc(leadId);
                } else {
                    leadDocRef = db.collection('companies').doc(companyId).collection('applications').doc(leadId);
                }

                const leadSnap = await leadDocRef.get();
                if (!leadSnap.exists) {
                    throw new Error("Lead document missing");
                }

                const leadData = leadSnap.data();
                recipientName = `${leadData.firstName || 'Driver'} ${leadData.lastName || ''}`.trim();
                const phone = leadData.phone || leadData.phoneNumber;

                // Compliance Check
                // Note: Checking blacklist one by one. 
                // Optimization: Could fetch blacklist cache for company beforehand, but isBlacklisted cache handles it well.
                const blacklisted = await isBlacklisted(companyId, phone);

                if (blacklisted) {
                    errorMsg = "Number is blacklisted (Opt-out)";
                    success = false;
                } else if (config.method === 'sms') {
                    if (!adapter) throw new Error("SMS Configuration Invalid");

                    recipientIdentity = phone || "No Phone";
                    if (recipientIdentity !== "No Phone") {
                        // Variable Injection
                        const finalMsg = config.message
                            .replace(/\[Driver Name\]/g, leadData.firstName || 'Driver')
                            .replace(/\[Company Name\]/g, companyName)
                            .replace(/\[Recruiter Name\]/g, config.recruiterName || 'your recruiter');

                        // Send
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
                            from: `"${companyName}" <${emailTransporter.transporter.options.auth.user}>`, // approximate access
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

            } catch (err) {
                // console.error(`Item Error ${leadId}:`, err.message); // Too noisy?
                errorMsg = err.message || "Unknown error";
                success = false;
            }

            return {
                leadId,
                recipientName,
                recipientIdentity,
                status: success ? 'delivered' : 'failed',
                error: errorMsg,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                isSuccess: success
            };
        }));

        // --- 3. BATCH WRITE RESULTS & UPDATE SESSION ---
        const batchWrite = db.batch();
        // Change collection name to 'logs' for clarity and easier frontend fetching
        const logsRef = sessionRef.collection('logs');

        let batchSuccessCount = 0;
        let batchFailCount = 0;

        results.forEach(res => {
            const docRef = logsRef.doc(res.leadId); // Use leadId as key to avoid duplicates
            // Remove 'isSuccess' helper from data stored to DB
            const { isSuccess, ...dbData } = res;
            batchWrite.set(docRef, dbData);

            if (res.isSuccess) batchSuccessCount++;
            else batchFailCount++;
        });

        // Commit logs
        await batchWrite.commit();

        // Update Session Progress
        const isKnownLast = (endPointer >= targetIds.length);

        await sessionRef.update({
            currentPointer: endPointer,
            'progress.processedCount': admin.firestore.FieldValue.increment(batchIds.length),
            'progress.successCount': admin.firestore.FieldValue.increment(batchSuccessCount),
            'progress.failedCount': admin.firestore.FieldValue.increment(batchFailCount),
            status: isKnownLast ? 'completed' : 'active',
            lastUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
            // If we finished, mark completedAt
            ...(isKnownLast ? { completedAt: admin.firestore.FieldValue.serverTimestamp() } : {})
        });

        // --- 4. SCHEDULE NEXT BATCH ---
        if (!isKnownLast) {
            // Processing 50 items takes time, effectively creating a natural delay.
            // We can add a small delay to be safe, e.g. 1-2 seconds between batches 
            // to allow other functions to breathe if needed.
            const nextDelay = 1;
            await enqueueWorker(companyId, sessionId, nextDelay);
        }

        res.status(200).send(`Processed batch of ${batchIds.length}. Success: ${batchSuccessCount}, Fail: ${batchFailCount}`);

    } catch (error) {
        console.error("[processBulkBatch] Critical Error:", error);
        res.status(500).send(error.message);
    }
});

async function enqueueWorker(companyId, sessionId, delaySeconds) {
    const queuePath = tasksClient.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME);

    // V2 URL Logic: Cloud Run URLs follow a different pattern than V1.
    // For this project 'truckerapp-system' in 'us-central1', the discovered URL is:
    // https://processbulkbatch-kswpqm6w2q-uc.a.run.app (uc = us-central1)

    let url = process.env.PROCESS_BULK_BATCH_URL;
    if (!url) {
        if (PROJECT_ID === 'truckerapp-system' && LOCATION === 'us-central1') {
            url = `https://processbulkbatch-kswpqm6w2q-uc.a.run.app/processBulkBatch`;
        } else {
            // Fallback to V1 pattern (might fail if deployed as V2)
            url = `https://${LOCATION}-${PROJECT_ID}.cloudfunctions.net/processBulkBatch`;
        }
    }

    const payload = { companyId, sessionId };
    const task = {
        httpRequest: {
            httpMethod: "POST",
            url,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(JSON.stringify(payload)).toString("base64"),
            oidcToken: {
                serviceAccountEmail: `truckerapp-system@appspot.gserviceaccount.com`, // Default SA for the project
                audience: url
            }
        }
    };
    if (delaySeconds > 0) {
        task.scheduleTime = { seconds: Date.now() / 1000 + delaySeconds };
    }

    try {
        await tasksClient.createTask({ parent: queuePath, task });
        console.log(`[enqueueWorker] Task created for session ${sessionId} with delay ${delaySeconds}s`);
    } catch (err) {
        console.error(`[enqueueWorker] CRITICAL: Failed to create Cloud Task for session ${sessionId}:`, err.message);
        console.error(`  - Queue Path: ${queuePath}`);
        console.error(`  - Task URL: ${url}`);
        console.error(`  - Ensure 'bulk-actions-queue' exists in Cloud Tasks for region ${LOCATION}`);

        // Update session to failed status so UI can show feedback
        try {
            await db.collection('companies').doc(companyId)
                .collection('bulk_sessions').doc(sessionId)
                .update({
                    status: 'failed',
                    error: `Cloud Tasks Enqueue Failed: ${err.message}. Ensure the 'bulk-actions-queue' exists in GCP region ${LOCATION}.`,
                    failedAt: admin.firestore.FieldValue.serverTimestamp()
                });
        } catch (updateErr) {
            console.error(`[enqueueWorker] Also failed to update session ${sessionId} to 'failed':`, updateErr.message);
        }

        throw err; // Re-throw to propagate to the caller
    }
}


