// functions/statsAggregator.js
// Pre-computes daily stats on every activity write to eliminate N+1 queries

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

/**
 * Trigger: When a new activity log is created under any company's applications
 * Path: companies/{companyId}/applications/{appId}/activity_logs/{logId}
 * 
 * This function increments the appropriate counters in the pre-aggregated stats collection.
 */
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

        const companyId = event.params.companyId;
        const userId = data.performedBy || 'unknown';
        const outcome = data.outcome || 'other';
        const isCall = data.type === 'call' || (!data.type && data.outcome);

        // Only aggregate call activities
        if (!isCall) {
            return;
        }

        // Determine the date key (YYYY-MM-DD) in CHICAGO TIMEZONE
        // This ensures the "business day" matches what recruiters see on their screens
        let dateKey;
        try {
            let timestamp;
            if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                timestamp = data.timestamp.toDate();
            } else if (data.timestamp instanceof Date) {
                timestamp = data.timestamp;
            } else {
                timestamp = new Date(); // Fallback to now
            }

            // Convert to Chicago timezone for consistent business-day calculation
            const chicagoFormatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Chicago',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
            dateKey = chicagoFormatter.format(timestamp); // Returns "YYYY-MM-DD"
        } catch (err) {
            console.warn('[StatsAggregator] Could not parse timestamp:', err);
            // Fallback: use Chicago time for "now"
            const chicagoFormatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Chicago',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
            dateKey = chicagoFormatter.format(new Date());
        }

        // Reference to the daily stats document
        const statsRef = db.collection('companies').doc(companyId)
            .collection('stats_daily').doc(dateKey);

        try {
            await db.runTransaction(async (transaction) => {
                const statsDoc = await transaction.get(statsRef);

                // Initialize or update stats
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

            console.log(`[StatsAggregator] Updated stats for ${companyId}/${dateKey}`);
        } catch (error) {
            console.error('[StatsAggregator] Transaction failed:', error);
            // Don't throw - we don't want to fail the original activity write
        }
    }
);

/**
 * Trigger: Legacy 'activities' collection (for backwards compatibility)
 * Path: companies/{companyId}/applications/{appId}/activities/{activityId}
 */
exports.onLegacyActivityCreated = onDocumentCreated(
    {
        document: 'companies/{companyId}/applications/{appId}/activities/{activityId}',
        region: 'us-central1'
    },
    async (event) => {
        // Reuse the same logic - just different path
        const db = getDb();
        const data = event.data?.data();

        if (!data) return;

        const companyId = event.params.companyId;
        const userId = data.performedBy || 'unknown';
        const outcome = data.outcome || 'other';
        const isCall = data.type === 'call' || (!data.type && data.outcome);

        if (!isCall) return;

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

        try {
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

                stats.totalDials = (stats.totalDials || 0) + 1;

                switch (outcome) {
                    case 'interested':
                    case 'callback':
                        stats.connected = (stats.connected || 0) + 1;
                        if (outcome === 'callback') stats.callback = (stats.callback || 0) + 1;
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
                        if (data.isContact) stats.connected = (stats.connected || 0) + 1;
                        break;
                }

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
        } catch (error) {
            console.error('[StatsAggregator] Legacy trigger failed:', error);
        }
    }
);
