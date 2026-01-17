// functions/statsAggregator.js
// Pre-computes daily stats on every activity write to eliminate N+1 queries
// REFACTORED: Uses shared processStatsUpdate helper to avoid code duplication

const { onDocumentCreated } = require("firebase-functions/v2/firestore");

// --- HELPER: Lazy Database Connection ---
let dbInstance = null;

function getDb() {
    if (!dbInstance) {
        const admin = require("firebase-admin");
        const { getFirestore } = require("firebase-admin/firestore");

        if (!admin.apps.length) {
            admin.initializeApp();
        }

        dbInstance = getFirestore();
        dbInstance.settings({ ignoreUndefinedProperties: true });
    }
    return dbInstance;
}

// --- SHARED HELPER: Process Stats Update ---
// This function contains all the common logic for all 3 triggers
async function processStatsUpdate(db, companyId, data, triggerName) {
    const userId = data.performedBy || 'unknown';
    const outcome = data.outcome || 'other';
    const isCall = data.type === 'call' || (!data.type && data.outcome);

    // Only aggregate call activities
    if (!isCall) {
        return null;
    }

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

    await db.runTransaction(async (transaction) => {
        const statsDoc = await transaction.get(statsRef);

        let stats = statsDoc.exists ? statsDoc.data() : {
            totalDials: 0,
            connected: 0,
            voicemail: 0,
            notInterested: 0,
            notQualified: 0,
            callback: 0,
            byUser: {},
            createdAt: new Date()
        };

        // Increment global counters
        stats.totalDials = (stats.totalDials || 0) + 1;

        // Increment outcome-specific counters
        switch (outcome) {
            case 'interested':
            case 'callback':
                stats.connected = (stats.connected || 0) + 1;
                if (outcome === 'callback') {
                    stats.callback = (stats.callback || 0) + 1;
                }
                break;
            case 'not_interested':
            case 'hired_elsewhere':
                stats.notInterested = (stats.notInterested || 0) + 1;
                break;
            case 'not_qualified':
            case 'wrong_number':
                stats.notQualified = (stats.notQualified || 0) + 1;
                break;
            case 'voicemail':
            case 'no_answer':
                stats.voicemail = (stats.voicemail || 0) + 1;
                break;
            default:
                if (data.isContact) {
                    stats.connected = (stats.connected || 0) + 1;
                }
                break;
        }

        // Increment per-user counters
        if (!stats.byUser[userId]) {
            stats.byUser[userId] = {
                name: data.performedByName || 'Unknown',
                dials: 0,
                connected: 0
            };
        }
        stats.byUser[userId].dials = (stats.byUser[userId].dials || 0) + 1;

        if (['interested', 'callback'].includes(outcome) || data.isContact) {
            stats.byUser[userId].connected = (stats.byUser[userId].connected || 0) + 1;
        }

        stats.updatedAt = new Date();
        transaction.set(statsRef, stats);
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
        const db = getDb();
        const data = event.data?.data();

        if (!data) {
            console.warn('[StatsAggregator] No data in created document');
            return;
        }

        try {
            const dateKey = await processStatsUpdate(db, event.params.companyId, data, 'StatsAggregator');
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
        const db = getDb();
        const data = event.data?.data();

        if (!data) return;

        try {
            const dateKey = await processStatsUpdate(db, event.params.companyId, data, 'LegacyAggregator');
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
        const db = getDb();
        const data = event.data?.data();

        if (!data) {
            console.warn('[LeadsAggregator] No data in leads activity document');
            return;
        }

        try {
            const dateKey = await processStatsUpdate(db, event.params.companyId, data, 'LeadsAggregator');
            if (dateKey) {
                console.log(`[LeadsAggregator] Updated stats for LEAD activity: ${event.params.companyId}/${dateKey}`);
            }
        } catch (error) {
            console.error('[LeadsAggregator] Leads trigger failed:', error);
        }
    }
);
