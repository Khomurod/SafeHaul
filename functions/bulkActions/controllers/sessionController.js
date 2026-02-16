const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");
const { assertCompanyAdmin } = require("../helpers/auth");
const { buildLeadQueries } = require("../helpers/queryBuilder");
const { enqueueWorker } = require("../services/queueService");

/**
 * 1. Initialize Bulk Session
 */
exports.initBulkSession = onCall({ cors: true, timeoutSeconds: 540 }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated');

    const { companyId, filters, config, sessionName, targetIds } = request.data;
    if (!companyId || !config || !config.message) {
        throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    // RBAC
    await assertCompanyAdmin(request.auth.uid, companyId);

    const leadSourceType = filters.leadType || 'applications'; // 'global', 'leads', 'applications' (default)

    // A. ID Gathering Phase
    let finalTargetIds = [];
    if (targetIds && Array.isArray(targetIds) && targetIds.length > 0) {
        // Direct Selection (e.g. from table selection)
        finalTargetIds = targetIds;

    } else if (leadSourceType === 'import' && request.data.rawData && Array.isArray(request.data.rawData)) {
        // C. Import: Raw Data Handling
        // We defer ID generation until after session creation used to guarantee unique IDs
        // or we generate them later. For now, we leave finalTargetIds empty and rely on the check below.
        finalTargetIds = [];

    } else {
        // Query Based
        const queries = buildLeadQueries(companyId, filters, request.auth.uid);

        // Execute all queries to get IDs
        try {
            // Need to fetch DATA to filter in-memory for missing fields (Cloud Firestore limitation)
            const snapshots = await Promise.all(queries.map(q => q.get()));
            const idSet = new Set();

            // Filter Setup
            let excludeThreshold = null;
            if (filters.excludeRecentDays) {
                const days = parseInt(filters.excludeRecentDays);
                const date = new Date();
                date.setDate(date.getDate() - days);
                excludeThreshold = admin.firestore.Timestamp.fromDate(date);
            }

            snapshots.forEach(snap => {
                snap.docs.forEach(d => {
                    const data = d.data();
                    let include = true;
                    // In-Memory Filter: Exclude Recent
                    if (excludeThreshold) {
                        if (data.lastBulkMessageAt && data.lastBulkMessageAt >= excludeThreshold) {
                            include = false;
                        }
                    }

                    // In-Memory Filter: Excluded Leads
                    if (filters.excludedLeadIds && filters.excludedLeadIds.includes(d.id)) {
                        include = false;
                    }
                    if (include) idSet.add(d.id);
                });
            });
            finalTargetIds = Array.from(idSet);
        } catch (qErr) {
            throw new HttpsError('internal', `Query execution failed: ${qErr.message}`);
        }
    }


    if (finalTargetIds.length === 0 && (!request.data.rawData || leadSourceType !== 'import')) {
        // Only return error if NOT import (since import logic handles IDs below)
        return { success: false, message: "No leads found matching criteria." };
    }

    // B. Create Session Doc
    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc();
    const sessionId = sessionRef.id;

    // Handle Import Persistence NOW if applicable
    if (leadSourceType === 'import' && request.data.rawData) {
        const rawItems = request.data.rawData;
        const batchArray = [];
        let batch = db.batch();
        let count = 0;

        for (let i = 0; i < rawItems.length; i++) {
            const item = rawItems[i];
            const importId = `imp_${i}_${Date.now()}`; // Simple unique ID within session context
            finalTargetIds.push(importId);

            const targetRef = sessionRef.collection('targets').doc(importId);
            batch.set(targetRef, {
                ...item,
                importedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            count++;

            if (count >= 490) { // Safety margin < 500
                batchArray.push(batch);
                batch = db.batch();
                count = 0;
            }
        }
        if (count > 0) batchArray.push(batch);

        // Execute all batches
        await Promise.all(batchArray.map(b => b.commit()));
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
        stats: {
            total: finalTargetIds.length,
            processed: 0,
            success: 0,
            failed: 0
        },
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
        await enqueueWorker(companyId, sessionId, 1);
    } catch (e) {
        // If queue fails, mark session failed
        await sessionRef.update({ status: 'failed', error: 'Failed to start queue.' });
        throw e;
    }

    return { success: true, sessionId: sessionId, count: finalTargetIds.length };
});


/**
 * 2. Control Actions (Pause, Resume, Cancel)
 */
const updateSessionStatus = async (request, status) => {
    if (!request.auth) throw new HttpsError('unauthenticated');
    const { companyId, sessionId } = request.data;
    await assertCompanyAdmin(request.auth.uid, companyId);

    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);
    await sessionRef.update({
        status: status,
        updatedBy: request.auth.uid,
        lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // If resuming, kick off worker again
    if (status === 'active') {
        const snap = await sessionRef.get();
        // Check if completed
        if (snap.data().progress.currentPointer < snap.data().targetIds.length) {
            await enqueueWorker(companyId, sessionId, 1);
        }
    }
    return { success: true };
};

exports.pauseBulkSession = onCall({ cors: true }, (req) => updateSessionStatus(req, 'paused'));
exports.resumeBulkSession = onCall({ cors: true }, (req) => updateSessionStatus(req, 'active'));
exports.cancelBulkSession = onCall({ cors: true }, (req) => updateSessionStatus(req, 'cancelled'));


/**
 * 3. Retry Failed
 */
exports.retryFailedAttempts = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated');
    const { companyId, sessionId } = request.data;
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

    await newSessionRef.set({
        ...data, // Copy config/filters
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
        retryCount: (data.retryCount || 0) + 1
    });

    await enqueueWorker(companyId, newSessionId, 1);

    return { success: true, newSessionId };
});
