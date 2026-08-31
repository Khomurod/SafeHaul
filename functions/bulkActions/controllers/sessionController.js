const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");
const { assertCompanyAdmin } = require("../helpers/auth");
const { enqueueWorker } = require("../services/queueService");
const { checkRateLimit } = require("../../shared/rateLimiter");
const { verifyDirectSelection, gatherIdsFromQueries } = require("./session/gatherTargets");
const { persistImportTargets } = require("./session/importTargets");

/**
 * 1. Initialize Bulk Session
 */
exports.initBulkSession = onCall({
    cors: true,
    timeoutSeconds: 540,
    secrets: ['BULK_WORKER_SECRET', 'PROCESS_BULK_BATCH_URL'],
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated');

    const { companyId, filters, config, sessionName, targetIds } = request.data;
    if (!companyId || !config || !config.message) {
        throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    // RBAC
    await assertCompanyAdmin(request.auth.uid, companyId);

    // BULK-5 FIX: Rate limit bulk session creation to prevent runaway SMS spend.
    // Maximum 10 bulk sessions per company per hour. A session may still contain thousands
    // of recipients, so this prevents accidental double-submits, not intentional high volume.
    const isAllowed = await checkRateLimit(`bulk_init_${companyId}`, 10, 3600, 'closed');
    if (!isAllowed) {
        throw new HttpsError('resource-exhausted', 'Too many bulk sessions created recently. Please wait before starting another.');
    }

    const leadSourceType = filters.leadType || 'applications'; // 'global', 'leads', 'applications' (default)

    // A. ID Gathering Phase
    let finalTargetIds = [];
    if (targetIds && Array.isArray(targetIds) && targetIds.length > 0) {
        // Direct Selection (e.g. from table selection)
        finalTargetIds = await verifyDirectSelection({ companyId, targetIds });

    } else if (leadSourceType === 'import' && request.data.rawData && Array.isArray(request.data.rawData)) {
        // C. Import: Raw Data Handling
        // We defer ID generation until after session creation used to guarantee unique IDs
        // or we generate them later. For now, we leave finalTargetIds empty and rely on the check below.
        finalTargetIds = [];

    } else {
        // Query Based
        finalTargetIds = await gatherIdsFromQueries({
            companyId,
            filters,
            config,
            authUid: request.auth.uid,
        });
    }


    if (finalTargetIds.length === 0 && (!request.data.rawData || leadSourceType !== 'import')) {
        // Only return error if NOT import (since import logic handles IDs below)
        return { success: false, message: "No leads found matching criteria." };
    }

    // B. Create Session Doc
    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc();
    const sessionId = sessionRef.id;

    // Handle Import Persistence NOW if applicable
    let importFilteredCount = 0;
    if (leadSourceType === 'import' && request.data.rawData) {
        ({ finalTargetIds, importFilteredCount } = await persistImportTargets({
            companyId,
            sessionRef,
            rawItems: request.data.rawData,
            filters,
            config,
            finalTargetIds,
        }));
    }

    // Validate count again after import processing
    if (finalTargetIds.length === 0) {
        return { success: false, message: "No leads found matching criteria (or empty import)." };
    }


    // Persist targets to subcollection if too large for single doc array (Map limit 1MB)
    // 50k IDs * 20 chars = 1MB. So > 10k is risky.
    // Strategy: Store in doc if < 5000, else use batches?
    // For now, consistent strategy: store in `targets` subcollection if 'import', or just array if reasonable?
    // Actually, `bulkActions_OLD.js` stored them in `targetIds` array on doc.
    // If list is huge (e.g. 50k), this fails Firestore limit.
    // FIX: We will store IDs in chunks in a subcollection 'partitions' or just rely on 'targetIds' for now (assuming < 10k use cases).
    // If > 10k, we should throw or handle.
    if (finalTargetIds.length > 10000) {
        throw new HttpsError('invalid-argument', 'Too many leads selected. Please narrow filters (< 10,000).');
    }

    // Optimization: Store leadSourceType on session
    await sessionRef.set({
        id: sessionId,
        name: sessionName || `Bulk Action ${new Date().toLocaleDateString()}`,
        status: 'pending', // pending -> active
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: request.auth.uid,
        updatedBy: request.auth.uid,
        config: config, // { method: 'sms'|'email', message: '...', ... }
        filters: filters,
        leadSourceType: leadSourceType,
        targetIds: finalTargetIds, // Array of strings
        // AUDIT FIX #4: Worker generation counter for zombie prevention
        workerGeneration: 1,
        // BUG-4 FIX: Removed redundant 'stats' field — only 'progress' is updated by the worker.
        progress: {
            currentPointer: 0, // Index in targetIds
            totalCount: finalTargetIds.length,
            processedCount: 0,
            successCount: 0,
            failedCount: 0
        },
        lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // C. Import Targets (Optional - if we need specific data snapshot)
    // If 'import' type, we assume targetIds came with data?
    // For now, we rely on fetching current data during worker execution.

    // D. Start Worker (Async)
    await sessionRef.update({ status: 'active' });

    // Kick off the first batch (Delay 1s)
    try {
        await enqueueWorker(companyId, sessionId, 1, 1); // workerGeneration = 1
    } catch (e) {
        // If queue fails, mark session failed
        await sessionRef.update({ status: 'failed', error: 'Failed to start queue.' });
        throw e;
    }

    return { success: true, sessionId: sessionId, targetCount: finalTargetIds.length, filteredCount: importFilteredCount };
});


/**
 * 2. Control Actions (Pause, Resume, Cancel)
 */
const updateSessionStatus = async (request, status) => {
    if (!request.auth) throw new HttpsError('unauthenticated');
    const { companyId, sessionId } = request.data;
    await assertCompanyAdmin(request.auth.uid, companyId);

    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);

    // AUDIT FIX #4: Increment workerGeneration on resume to invalidate stale workers
    const updatePayload = {
        status: status,
        updatedBy: request.auth.uid,
        lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (status === 'active') {
        updatePayload.workerGeneration = admin.firestore.FieldValue.increment(1);
    }
    await sessionRef.update(updatePayload);

    // If resuming, kick off worker again.
    // P2 HARDENING: Defensive reads — older/failed sessions may be missing
    // `progress` or `targetIds`. Crashing here means a recruiter clicks Resume
    // and sees an opaque INTERNAL error with no recovery path.
    if (status === 'active') {
        const snap = await sessionRef.get();
        if (!snap.exists) {
            throw new HttpsError('not-found', 'Session not found.');
        }
        const sessionData = snap.data() || {};
        const pointer = sessionData.progress?.currentPointer ?? 0;
        const total = Array.isArray(sessionData.targetIds) ? sessionData.targetIds.length : 0;
        if (total === 0) {
            // Already-empty target list — mark as completed instead of busy-looping a worker.
            await sessionRef.update({
                status: 'completed',
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return { success: true, message: 'No remaining targets — session marked complete.' };
        }
        if (pointer < total) {
            await enqueueWorker(companyId, sessionId, 1, sessionData.workerGeneration);
        }
    }
    return { success: true };
};

exports.pauseBulkSession = onCall({ cors: true }, (req) => updateSessionStatus(req, 'paused'));
exports.resumeBulkSession = onCall(
    { cors: true, secrets: ['BULK_WORKER_SECRET', 'PROCESS_BULK_BATCH_URL'] },
    (req) => updateSessionStatus(req, 'active'),
);
exports.cancelBulkSession = onCall({ cors: true }, (req) => updateSessionStatus(req, 'cancelled'));


/**
 * 3. Retry Failed
 */
exports.retryFailedAttempts = onCall(
    { cors: true, secrets: ['BULK_WORKER_SECRET', 'PROCESS_BULK_BATCH_URL'] },
    async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated');
    // BUG-1 FIX: Frontend sends 'originalSessionId' but backend expected 'sessionId'.
    // Accept both for backward compatibility.
    const { companyId, sessionId: directId, originalSessionId } = request.data;
    const sessionId = directId || originalSessionId;
    if (!sessionId) throw new HttpsError('invalid-argument', 'Session ID is required.');
    await assertCompanyAdmin(request.auth.uid, companyId);

    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);
    const snap = await sessionRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Session not found');

    const data = snap.data();

    // Identify failed IDs
    // We can query the 'logs' subcollection for status: 'failed'
    const logsSnap = await sessionRef.collection('logs').where('status', '==', 'failed').get();
    const failedIds = logsSnap.docs.map(d => d.id);

    if (failedIds.length === 0) return { success: true, message: "No failed items to retry." };

    // Create NEW session for retry
    const newSessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc();
    const newSessionId = newSessionRef.id;

    // BUG-11 FIX: Remove heavy/non-transfer fields before spreading so we don't
    // duplicate the original full targetIds array in the retry session document.
    const sessionConfig = { ...data };
    delete sessionConfig.targetIds;
    delete sessionConfig.id;
    delete sessionConfig.progress;

    await newSessionRef.set({
        ...sessionConfig, // Copy config/filters without the heavy fields
        id: newSessionId,
        name: `${data.name} (Retry)`,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        targetIds: failedIds,
        progress: {
            currentPointer: 0,
            totalCount: failedIds.length,
            processedCount: 0,
            successCount: 0,
            failedCount: 0
        },
        retryOf: sessionId,
        retryCount: (data.retryCount || 0) + 1,
        // AUDIT FIX #3: For import-type retries, store the original session ID
        // so the worker knows where to find target docs in the 'targets' subcollection.
        importSourceSessionId: data.importSourceSessionId || sessionId,
        // AUDIT FIX #4: Reset worker generation for new session
        workerGeneration: 1
    });

    await enqueueWorker(companyId, newSessionId, 1, 1); // workerGeneration = 1

    return { success: true, newSessionId };
});
