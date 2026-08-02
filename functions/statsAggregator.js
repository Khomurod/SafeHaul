// functions/statsAggregator.js
// Pre-computes daily stats on every activity write to eliminate N+1 queries
// REFACTORED: Uses shared processStatsUpdate helper to avoid code duplication

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
// H5 FIX: Use shared db instance from firebaseAdmin instead of lazy-initializing a duplicate
const { db, admin } = require("./firebaseAdmin");

// CALL-4 FIX: Derive isContact server-side from a trusted allowlist.
// Never trust the client-supplied isContact boolean — it can be forged to inflate "connected" counts.
const CONTACT_OUTCOMES = new Set(['interested', 'callback', 'not_qualified', 'not_interested', 'hired_elsewhere']);

// --- SHARED HELPER: Process Stats Update ---
// This function contains all the common logic for all triggers
async function processStatsUpdate(db, companyId, data, logId, triggerName) {
    // CALL-10 FIX: Require `action === 'Call Logged'` to prevent notes, status changes,
    // and other activity types from inflating totalDials.
    // For backwards compatibility, also accept documents with `type === 'call'` and no
    // `action` field (legacy log format written before the action field was added).
    const isCall = data.action === 'Call Logged' || (data.type === 'call' && !data.action);
    if (!isCall) {
        return null;
    }

    const userId = data.performedBy || 'unknown';
    const outcome = data.outcome || 'other';
    // CALL-4 FIX: Re-derive isContact from trusted server-side allowlist
    const isContact = CONTACT_OUTCOMES.has(outcome);

    // Determine the date key (YYYY-MM-DD) in CHICAGO TIMEZONE
    let dateKey;
    try {
        let timestamp;
        if (data.timestamp && typeof data.timestamp.toDate === 'function') {
            timestamp = data.timestamp.toDate();
        } else if (data.timestamp instanceof Date) {
            timestamp = data.timestamp;
        } else {
            timestamp = new Date();
        }

        const chicagoFormatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        dateKey = chicagoFormatter.format(timestamp);
    } catch (err) {
        console.warn(`[${triggerName}] Could not parse timestamp:`, err);
        const chicagoFormatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        dateKey = chicagoFormatter.format(new Date());
    }

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
            totalDials: 0,
            connected: 0,
            interested: 0,
            voicemail: 0,
            callback: 0,
            notInterested: 0,
            hiredElsewhere: 0,
            notQualified: 0,
            wrongNumber: 0,
            byUser: {},
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // CALL-7 FIX: Use in-transaction counters (transaction already prevents concurrent issues).
        // For further scale, consider FieldValue.increment with sharded counters.
        stats.totalDials = (stats.totalDials || 0) + 1;

        // CALL-4 FIX: Use server-side derived isContact
        if (isContact) {
            stats.connected = (stats.connected || 0) + 1;
        }

        // CALL-5 FIX: Correct semantic bucketing + CALL-6 FIX: Add interested counter
        switch (outcome) {
            case 'interested':
                // CALL-6 FIX: Track interested separately — highest-value outcome for conversion rate
                stats.interested = (stats.interested || 0) + 1;
                break;
            case 'callback':
                stats.callback = (stats.callback || 0) + 1;
                break;
            case 'not_interested':
                stats.notInterested = (stats.notInterested || 0) + 1;
                break;
            case 'hired_elsewhere':
                // CALL-5 FIX: hired_elsewhere is an availability signal, not "not interested"
                stats.hiredElsewhere = (stats.hiredElsewhere || 0) + 1;
                break;
            case 'not_qualified':
                stats.notQualified = (stats.notQualified || 0) + 1;
                break;
            case 'wrong_number':
                // CALL-5 FIX: wrong_number is a data-quality signal, not "not qualified"
                stats.wrongNumber = (stats.wrongNumber || 0) + 1;
                break;
            case 'voicemail':
            case 'no_answer':
                stats.voicemail = (stats.voicemail || 0) + 1;
                break;
            default:
                break;
        }

        // CALL-1 FIX: Mirror ALL outcome counters in the per-user object.
        // Previously only dials+connected were tracked per user, leaving all outcome columns at 0.
        if (!stats.byUser[userId]) {
            stats.byUser[userId] = {
                name: data.performedByName || 'Unknown',
                dials: 0,
                connected: 0,
                interested: 0,
                voicemail: 0,
                callback: 0,
                notInterested: 0,
                hiredElsewhere: 0,
                notQualified: 0,
                wrongNumber: 0,
            };
        }
        stats.byUser[userId].dials = (stats.byUser[userId].dials || 0) + 1;

        if (isContact) {
            stats.byUser[userId].connected = (stats.byUser[userId].connected || 0) + 1;
        }
        switch (outcome) {
            case 'interested':
                stats.byUser[userId].interested = (stats.byUser[userId].interested || 0) + 1;
                break;
            case 'callback':
                stats.byUser[userId].callback = (stats.byUser[userId].callback || 0) + 1;
                break;
            case 'not_interested':
                stats.byUser[userId].notInterested = (stats.byUser[userId].notInterested || 0) + 1;
                break;
            case 'hired_elsewhere':
                stats.byUser[userId].hiredElsewhere = (stats.byUser[userId].hiredElsewhere || 0) + 1;
                break;
            case 'not_qualified':
                stats.byUser[userId].notQualified = (stats.byUser[userId].notQualified || 0) + 1;
                break;
            case 'wrong_number':
                stats.byUser[userId].wrongNumber = (stats.byUser[userId].wrongNumber || 0) + 1;
                break;
            case 'voicemail':
            case 'no_answer':
                stats.byUser[userId].voicemail = (stats.byUser[userId].voicemail || 0) + 1;
                break;
            default:
                break;
        }

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

// --- TRIGGER 2: Legacy 'activities' collection (backwards compatibility) ---
exports.onLegacyActivityCreated = onDocumentCreated(
    {
        document: 'companies/{companyId}/applications/{appId}/activities/{activityId}',
        region: 'us-central1'
    },
    async (event) => {

        const data = event.data?.data();

        if (!data) return;

        try {
            const dateKey = await processStatsUpdate(db, event.params.companyId, data, event.params.activityId, 'LegacyAggregator');
            if (dateKey) {
                console.log(`[LegacyAggregator] Updated stats for ${event.params.companyId}/${dateKey}`);
            }
        } catch (error) {
            console.error('[LegacyAggregator] Legacy trigger failed:', error);
        }
    }
);

// --- TRIGGER 3: activity_logs under LEADS collection ---
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

// --- TRIGGER 4: Legacy activities under LEADS collection ---
// CALL-13 FIX: Cover the legacy leads/{leadId}/activities/{activityId} path
exports.onLeadsLegacyActivityCreated = onDocumentCreated(
    {
        document: 'companies/{companyId}/leads/{leadId}/activities/{activityId}',
        region: 'us-central1'
    },
    async (event) => {

        const data = event.data?.data();

        if (!data) return;

        try {
            const dateKey = await processStatsUpdate(db, event.params.companyId, data, event.params.activityId, 'LeadsLegacyAggregator');
            if (dateKey) {
                console.log(`[LeadsLegacyAggregator] Updated stats for LEAD legacy activity: ${event.params.companyId}/${dateKey}`);
            }
        } catch (error) {
            console.error('[LeadsLegacyAggregator] Leads legacy trigger failed:', error);
        }
    }
);
