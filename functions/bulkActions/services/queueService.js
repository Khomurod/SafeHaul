const { admin, db } = require("../../firebaseAdmin");
const { CloudTasksClient } = require("@google-cloud/tasks");

const PROJECT_ID = (admin.apps.length ? admin.app().options.projectId : null) || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
// Allow region to be configured, default to us-central1 if not set
const LOCATION = process.env.FUNCTION_REGION || process.env.GCP_REGION || 'us-central1';
const QUEUE_NAME = "bulk-actions-queue";
const TASKS_CLIENT_OPTS = {};
// Initialize client with fallback if needed, but usually default is fine in Cloud Functions
const tasksClient = new CloudTasksClient(TASKS_CLIENT_OPTS);

// AUDIT FIX #4: Accept workerGeneration to forward in task payload
async function enqueueWorker(companyId, sessionId, delaySeconds, workerGeneration = null) {
    // Fail-closed: never enqueue a task without the shared worker secret. Sending an
    // empty header would let the worker reject the task at the far end, but enqueuing
    // an unauthenticatable task wastes a Cloud Tasks slot and masks the real config
    // error — surface it here so the campaign fails fast and visibly.
    const workerSecret = process.env.BULK_WORKER_SECRET;
    if (!workerSecret) {
        throw new Error("CRITICAL CONFIG ERROR: BULK_WORKER_SECRET env var is missing. Refusing to enqueue an unauthenticated worker task.");
    }

    const queuePath = tasksClient.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME);

    // FIX: V2 URL Logic & Env Var Requirement
    let url = process.env.PROCESS_BULK_BATCH_URL;
    if (!url) {
        if (process.env.FUNCTIONS_EMULATOR) {
            url = `http://127.0.0.1:5001/${PROJECT_ID}/${LOCATION}/processBulkBatch`;
        } else {
            // CRITICAL: Cannot guess V2 URLs
            throw new Error("CRITICAL CONFIG ERROR: PROCESS_BULK_BATCH_URL env var is missing. Cannot recurse.");
        }
    }

    // FIX: Dynamic Service Account
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
    const serviceAccountEmail = firebaseConfig.serviceAccount || `${PROJECT_ID}@appspot.gserviceaccount.com`;

    const payload = { companyId, sessionId };
    // AUDIT FIX #4: Include workerGeneration so batch worker can detect stale invocations
    if (typeof workerGeneration === 'number') {
        payload.workerGeneration = workerGeneration;
    }
    const task = {
        httpRequest: {
            httpMethod: "POST",
            url,
            headers: {
                "Content-Type": "application/json",
                // SECURITY: Inject shared secret for worker endpoint authentication
                // (guaranteed present — enqueueWorker throws above if unset).
                "X-SafeHaul-Internal-Auth": workerSecret
            },
            body: Buffer.from(JSON.stringify(payload)).toString("base64"),
            oidcToken: {
                serviceAccountEmail, // Uses dynamic account
                audience: url
            }
        }
    };
    if (delaySeconds > 0) {
        task.scheduleTime = { seconds: Math.floor(Date.now() / 1000 + delaySeconds) };
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

module.exports = { enqueueWorker, PROJECT_ID, LOCATION, QUEUE_NAME };
