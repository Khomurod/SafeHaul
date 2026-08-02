// functions/bulkActions/helpers/sessionFactory.js
//
// A3: single helper to create a `bulk_sessions` doc from an explicit list of
// target ids and start the recursive Cloud Tasks worker. This lets callers that
// already know exactly which leads to message (e.g. executeReactivationBatch)
// ride the same durable, observable rail as initBulkSession — batch-of-N,
// enqueue-next, zombie-prevention, per-session ceiling — instead of holding a
// function instance open with an in-process sleep loop.

const { admin, db } = require('../../firebaseAdmin');
const { enqueueWorker } = require('../services/queueService');

/**
 * Create an active bulk session for a known set of target ids and enqueue the
 * first worker batch.
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {string} params.createdBy - uid used for adapter routing + audit.
 * @param {string[]} params.targetIds - explicit lead/application ids to process.
 * @param {object} params.config - worker config, e.g. { method: 'sms', message }.
 * @param {'applications'|'leads'} [params.leadSourceType='applications']
 * @param {string} [params.sessionName]
 * @param {object} [params.filters={}]
 * @returns {Promise<{ sessionId: string, targetCount: number }>}
 */
async function createAndStartBulkSession({
    companyId,
    createdBy,
    targetIds,
    config,
    leadSourceType = 'applications',
    sessionName,
    filters = {},
}) {
    const sessionRef = db
        .collection('companies').doc(companyId)
        .collection('bulk_sessions').doc();
    const sessionId = sessionRef.id;

    // Mirror the session shape the worker reads (status/workerGeneration/progress
    // /config/targetIds). Keep in lockstep with sessionController.initBulkSession.
    await sessionRef.set({
        id: sessionId,
        name: sessionName || `Bulk Action ${new Date().toLocaleDateString()}`,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy,
        updatedBy: createdBy,
        config,
        filters,
        leadSourceType,
        targetIds,
        workerGeneration: 1,
        progress: {
            currentPointer: 0,
            totalCount: targetIds.length,
            processedCount: 0,
            successCount: 0,
            failedCount: 0,
        },
        lastUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await sessionRef.update({ status: 'active' });

    try {
        await enqueueWorker(companyId, sessionId, 1, 1); // workerGeneration = 1
    } catch (e) {
        await sessionRef.update({ status: 'failed', error: 'Failed to start queue.' });
        throw e;
    }

    return { sessionId, targetCount: targetIds.length };
}

module.exports = { createAndStartBulkSession };
