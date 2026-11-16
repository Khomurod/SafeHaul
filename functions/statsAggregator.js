// functions/statsAggregator.js
// Pre-computes daily stats on every activity write to eliminate N+1 queries
// REFACTORED: Uses shared processStatsUpdate helper to avoid code duplication

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
// H5 FIX: Use shared db instance from firebaseAdmin instead of lazy-initializing a duplicate
const { db, admin } = require("./firebaseAdmin");

// Which logs are calls, how each counts and on which Chicago day: shared with
// the rebuild (statsBackfill.js) so the two cannot disagree.
const { addCallToDayStats, chicagoDayKey, emptyDayStats, isCallLog } = require("./shared/callStats");

// --- SHARED HELPER: Process Stats Update ---
// This function contains all the common logic for all triggers
async function processStatsUpdate(db, companyId, data, logId, triggerName) {
    // Only calls count: notes, status changes and other activity never add a dial.
    if (!isCallLog(data)) {
        return null;
    }

    // The date key (YYYY-MM-DD) in CHICAGO TIMEZONE
    const dateKey = chicagoDayKey(data.timestamp, triggerName);

    const statsRef = db.collection('companies').doc(companyId)
        .collection('stats_daily').doc(dateKey);

    // IDEMPOTENCY: Use logId to prevent double counting
    const processedRef = statsRef.collection('processed_signals').doc(logId);

    await db.runTransaction(async (transaction) => {
        // 1. Check if already processed (inside transaction for atomicity)
        const processedDoc = await transaction.get(processedRef);
        if (processedDoc.exists) {
            console.log(`[${triggerName}] Log ${logId} already processed. Skipping.`);
            return;
        }

        const statsDoc = await transaction.get(statsRef);

        const stats = statsDoc.exists ? statsDoc.data() : {
            ...emptyDayStats(),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // In-transaction counters (the transaction already prevents concurrent issues),
        // the day's and the caller's, connected derived from the outcome server-side.
        addCallToDayStats(stats, data);

        // CALL-11 FIX: Use serverTimestamp() instead of new Date() for Firestore audit fields
        stats.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        transaction.set(statsRef, stats);
        // INFRA-2: processedAt is set for Firestore TTL policy to auto-delete processed_signals after 90 days.
        // IMPORTANT: The TTL policy must be created once in the Firebase project using the CLI:
        //   firebase firestore:ttl:create companies/{companyId}/activity_logs/{logId}/processed_signals processedAt
        // Without this CLI command the documents accumulate indefinitely. This is a one-time setup step.
        transaction.set(processedRef, { processedAt: admin.firestore.FieldValue.serverTimestamp() });
    });

    return dateKey;
}

// --- TRIGGER 1: Modern activity_logs under applications ---
exports.onActivityLogCreated = onDocumentCreated(
    {
        document: 'companies/{companyId}/applications/{appId}/activity_logs/{logId}',
        region: 'us-central1'
    },
    async (event) => {

        const data = event.data?.data();

        if (!data) {
            console.warn('[StatsAggregator] No data in created document');
            return;
        }

        try {
            const dateKey = await processStatsUpdate(db, event.params.companyId, data, event.params.logId, 'StatsAggregator');
            if (dateKey) {
                console.log(`[StatsAggregator] Updated stats for ${event.params.companyId}/${dateKey}`);
            }
        } catch (error) {
            console.error('[StatsAggregator] Transaction failed:', error);
        }
    }
);

// --- TRIGGER 2: activity_logs under LEADS collection ---
exports.onLeadsActivityLogCreated = onDocumentCreated(
    {
        document: 'companies/{companyId}/leads/{leadId}/activity_logs/{logId}',
        region: 'us-central1'
    },
    async (event) => {

        const data = event.data?.data();

        if (!data) {
            console.warn('[LeadsAggregator] No data in leads activity document');
            return;
        }

        try {
            const dateKey = await processStatsUpdate(db, event.params.companyId, data, event.params.logId, 'LeadsAggregator');
            if (dateKey) {
                console.log(`[LeadsAggregator] Updated stats for LEAD activity: ${event.params.companyId}/${dateKey}`);
            }
        } catch (error) {
            console.error('[LeadsAggregator] Leads trigger failed:', error);
        }
    }
);
