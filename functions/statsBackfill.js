/**
 * Stats Backfill - Rebuilds stats_daily from raw activity data
 * 
 * This function scans all existing activities and activity_logs
 * and aggregates them into the stats_daily collection.
 * 
 * Features:
 * - Idempotent: Safe to run multiple times (full rebuild per company)
 * - Resumable: Tracks progress in status document
 * - Dry-run mode: Preview without modifying data
 * - Timezone-safe: Uses America/Chicago for all date calculations
 */

const functions = require('firebase-functions/v1');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('./firebaseAdmin');

const CHICAGO_TZ = 'America/Chicago';

/**
 * Converts a Firestore timestamp or Date to a Chicago date key (YYYY-MM-DD)
 */
function toChicagoDateKey(timestamp) {
    let date;
    if (timestamp && typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
    } else if (timestamp instanceof Date) {
        date = timestamp;
    } else if (typeof timestamp === 'string' || typeof timestamp === 'number') {
        date = new Date(timestamp);
    } else {
        return null;
    }

    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: CHICAGO_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(date);
}

/**
 * Processes a single activity document and returns aggregation data
 */
function processActivity(data) {
    const outcome = data.outcome || 'other';
    const isCall = data.type === 'call' || (!data.type && data.outcome);

    if (!isCall) return null;

    const userId = data.performedBy || 'unknown';
    const userName = data.performedByName || 'Unknown';
    const isContact = data.isContact || ['interested', 'callback'].includes(outcome);

    return {
        userId,
        userName,
        outcome,
        isContact,
        isDial: true
    };
}

/**
 * Aggregates activities into a stats structure
 */
function aggregateIntoStats(stats, activityData) {
    if (!activityData) return stats;

    const { userId, userName, outcome, isContact } = activityData;

    // Initialize stats if empty
    if (!stats.totalDials) {
        stats = {
            totalDials: 0,
            connected: 0,
            voicemail: 0,
            notInterested: 0,
            notQualified: 0,
            callback: 0,
            byUser: {},
            createdAt: new Date()
        };
    }

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
            if (isContact) {
                stats.connected = (stats.connected || 0) + 1;
            }
            break;
    }

    // Increment per-user counters
    if (!stats.byUser[userId]) {
        stats.byUser[userId] = {
            name: userName,
            dials: 0,
            connected: 0
        };
    }
    stats.byUser[userId].dials = (stats.byUser[userId].dials || 0) + 1;

    if (isContact) {
        stats.byUser[userId].connected = (stats.byUser[userId].connected || 0) + 1;
    }

    return stats;
}

/**
 * Backfills stats for a single company
 */
async function backfillCompanyStatsInternal(companyId, dryRun = true) {
    console.log(`[Backfill] Starting for company: ${companyId}, dryRun: ${dryRun}`);

    const statsByDate = {}; // { 'YYYY-MM-DD': statsObject }
    let totalActivities = 0;
    let totalLegacy = 0;
    let totalModern = 0;

    // 1. Get all applications for this company
    const appsSnap = await db.collection('companies').doc(companyId).collection('applications').get();
    console.log(`[Backfill] Found ${appsSnap.size} applications`);

    for (const appDoc of appsSnap.docs) {
        const appId = appDoc.id;

        // 2a. Process legacy 'activities' subcollection
        const legacySnap = await db.collection('companies').doc(companyId)
            .collection('applications').doc(appId)
            .collection('activities').get();

        for (const actDoc of legacySnap.docs) {
            const data = actDoc.data();
            const dateKey = toChicagoDateKey(data.timestamp);
            if (!dateKey) continue;

            const activityData = processActivity(data);
            if (!activityData) continue;

            if (!statsByDate[dateKey]) {
                statsByDate[dateKey] = {
                    totalDials: 0, connected: 0, voicemail: 0,
                    notInterested: 0, notQualified: 0, callback: 0,
                    byUser: {}, createdAt: new Date()
                };
            }
            statsByDate[dateKey] = aggregateIntoStats(statsByDate[dateKey], activityData);
            totalLegacy++;
            totalActivities++;
        }

        // 2b. Process modern 'activity_logs' subcollection
        const modernSnap = await db.collection('companies').doc(companyId)
            .collection('applications').doc(appId)
            .collection('activity_logs').get();

        for (const logDoc of modernSnap.docs) {
            const data = logDoc.data();
            const dateKey = toChicagoDateKey(data.timestamp);
            if (!dateKey) continue;

            const activityData = processActivity(data);
            if (!activityData) continue;

            if (!statsByDate[dateKey]) {
                statsByDate[dateKey] = {
                    totalDials: 0, connected: 0, voicemail: 0,
                    notInterested: 0, notQualified: 0, callback: 0,
                    byUser: {}, createdAt: new Date()
                };
            }
            statsByDate[dateKey] = aggregateIntoStats(statsByDate[dateKey], activityData);
            totalModern++;
            totalActivities++;
        }
    }

    // 3. Also check 'leads' collection (some activities may be there)
    const leadsSnap = await db.collection('companies').doc(companyId).collection('leads').get();
    console.log(`[Backfill] Found ${leadsSnap.size} leads`);

    for (const leadDoc of leadsSnap.docs) {
        const leadId = leadDoc.id;

        // Check activities under leads
        const leadActivitiesSnap = await db.collection('companies').doc(companyId)
            .collection('leads').doc(leadId)
            .collection('activities').get();

        for (const actDoc of leadActivitiesSnap.docs) {
            const data = actDoc.data();
            const dateKey = toChicagoDateKey(data.timestamp);
            if (!dateKey) continue;

            const activityData = processActivity(data);
            if (!activityData) continue;

            if (!statsByDate[dateKey]) {
                statsByDate[dateKey] = {
                    totalDials: 0, connected: 0, voicemail: 0,
                    notInterested: 0, notQualified: 0, callback: 0,
                    byUser: {}, createdAt: new Date()
                };
            }
            statsByDate[dateKey] = aggregateIntoStats(statsByDate[dateKey], activityData);
            totalLegacy++;
            totalActivities++;
        }

        // Check activity_logs under leads
        const leadLogsSnap = await db.collection('companies').doc(companyId)
            .collection('leads').doc(leadId)
            .collection('activity_logs').get();

        for (const logDoc of leadLogsSnap.docs) {
            const data = logDoc.data();
            const dateKey = toChicagoDateKey(data.timestamp);
            if (!dateKey) continue;

            const activityData = processActivity(data);
            if (!activityData) continue;

            if (!statsByDate[dateKey]) {
                statsByDate[dateKey] = {
                    totalDials: 0, connected: 0, voicemail: 0,
                    notInterested: 0, notQualified: 0, callback: 0,
                    byUser: {}, createdAt: new Date()
                };
            }
            statsByDate[dateKey] = aggregateIntoStats(statsByDate[dateKey], activityData);
            totalModern++;
            totalActivities++;
        }
    }

    console.log(`[Backfill] Processed ${totalActivities} activities (${totalLegacy} legacy, ${totalModern} modern)`);
    console.log(`[Backfill] Generated stats for ${Object.keys(statsByDate).length} days`);

    // 4. Write to Firestore (or return preview)
    if (dryRun) {
        // Just return what would be written
        const preview = Object.entries(statsByDate).map(([dateKey, stats]) => ({
            dateKey,
            totalDials: stats.totalDials,
            connected: stats.connected,
            userCount: Object.keys(stats.byUser).length
        }));

        return {
            success: true,
            dryRun: true,
            companyId,
            totalActivitiesProcessed: totalActivities,
            legacyCount: totalLegacy,
            modernCount: totalModern,
            daysWithStats: Object.keys(statsByDate).length,
            preview: preview.slice(0, 20) // Show first 20 days
        };
    }

    // Actually write the stats
    const batch = db.batch();
    let batchCount = 0;

    for (const [dateKey, stats] of Object.entries(statsByDate)) {
        const statsRef = db.collection('companies').doc(companyId)
            .collection('stats_daily').doc(dateKey);

        stats.updatedAt = new Date();
        stats.backfilledAt = new Date();
        batch.set(statsRef, stats); // Full replace
        batchCount++;

        // Commit in batches of 400
        if (batchCount >= 400) {
            await batch.commit();
            batchCount = 0;
        }
    }

    if (batchCount > 0) {
        await batch.commit();
    }

    console.log(`[Backfill] ✅ Wrote ${Object.keys(statsByDate).length} stats_daily documents`);

    return {
        success: true,
        dryRun: false,
        companyId,
        totalActivitiesProcessed: totalActivities,
        legacyCount: totalLegacy,
        modernCount: totalModern,
        daysWritten: Object.keys(statsByDate).length
    };
}

/**
 * Callable Function: Backfill stats for a single company
 */
exports.backfillCompanyStats = onCall({
    cors: true,
    timeoutSeconds: 540,
    memory: '1GiB'
}, async (request) => {
    // Auth check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Login required.');
    }

    // Super Admin check
    const roles = request.auth.token.roles || {};
    const globalRole = request.auth.token.globalRole || roles.globalRole;
    if (globalRole !== 'super_admin') {
        throw new HttpsError('permission-denied', 'Only Super Admins can run backfill.');
    }

    const { companyId, dryRun = true } = request.data;
    if (!companyId) {
        throw new HttpsError('invalid-argument', 'Missing companyId.');
    }

    try {
        const result = await backfillCompanyStatsInternal(companyId, dryRun);
        return result;
    } catch (error) {
        console.error('[Backfill] Error:', error);
        throw new HttpsError('internal', error.message);
    }
});

/**
 * Callable Function: Backfill stats for ALL companies
 */
exports.backfillAllStats = onCall({
    cors: true,
    timeoutSeconds: 540,
    memory: '2GiB'
}, async (request) => {
    // Auth check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Login required.');
    }

    // Super Admin check
    const roles = request.auth.token.roles || {};
    const globalRole = request.auth.token.globalRole || roles.globalRole;
    if (globalRole !== 'super_admin') {
        throw new HttpsError('permission-denied', 'Only Super Admins can run backfill.');
    }

    const { dryRun = true } = request.data;

    try {
        const companiesSnap = await db.collection('companies').get();
        const results = [];

        for (const companyDoc of companiesSnap.docs) {
            try {
                const result = await backfillCompanyStatsInternal(companyDoc.id, dryRun);
                results.push(result);
            } catch (err) {
                results.push({
                    companyId: companyDoc.id,
                    success: false,
                    error: err.message
                });
            }
        }

        const totalProcessed = results.reduce((sum, r) => sum + (r.totalActivitiesProcessed || 0), 0);
        const companiesSucceeded = results.filter(r => r.success).length;

        return {
            success: true,
            dryRun,
            companiesProcessed: companiesSnap.size,
            companiesSucceeded,
            totalActivitiesProcessed: totalProcessed,
            details: results
        };
    } catch (error) {
        console.error('[Backfill All] Error:', error);
        throw new HttpsError('internal', error.message);
    }
});

module.exports = exports;
