// functions/statsBackfill.js
// CALL-3 FIX: Create the backfillCompanyStats and backfillAllStats Cloud Functions
// that StatsBackfillPanel.jsx calls. These were referenced in the UI but never implemented.
//
// These functions process ALL historical activity_logs and activities documents
// and rebuild stats_daily from scratch using the same processStatsUpdate logic
// defined in statsAggregator.js.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("./firebaseAdmin");
const { checkRateLimit } = require("./shared/rateLimiter");

const CONTACT_OUTCOMES = new Set(['interested', 'callback', 'not_qualified', 'not_interested', 'hired_elsewhere']);
const COLLECTION_GROUP_PAGE_SIZE = 1000;

function hasSuperAdminRole(claims = {}) {
    const globalRole = claims.globalRole || claims.roles?.globalRole;
    return globalRole === 'super_admin';
}

/**
 * Build stats for a single day's activities.
 */
function buildDayStats(activities) {
    const stats = {
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
    };

    for (const doc of activities) {
        const data = doc.data();
        const isCall = data.action === 'Call Logged' || (data.type === 'call' && !data.action);
        if (!isCall) continue;

        const userId = data.performedBy || 'unknown';
        const outcome = data.outcome || 'other';
        const isContact = CONTACT_OUTCOMES.has(outcome);

        stats.totalDials++;
        if (isContact) stats.connected++;

        switch (outcome) {
            case 'interested': stats.interested++; break;
            case 'callback': stats.callback++; break;
            case 'not_interested': stats.notInterested++; break;
            case 'hired_elsewhere': stats.hiredElsewhere++; break;
            case 'not_qualified': stats.notQualified++; break;
            case 'wrong_number': stats.wrongNumber++; break;
            case 'voicemail': case 'no_answer': stats.voicemail++; break;
            default: break;
        }

        if (!stats.byUser[userId]) {
            stats.byUser[userId] = {
                name: data.performedByName || 'Unknown',
                dials: 0, connected: 0, interested: 0, voicemail: 0,
                callback: 0, notInterested: 0, hiredElsewhere: 0,
                notQualified: 0, wrongNumber: 0,
            };
        }
        const u = stats.byUser[userId];
        u.dials++;
        if (isContact) u.connected++;
        switch (outcome) {
            case 'interested': u.interested++; break;
            case 'callback': u.callback++; break;
            case 'not_interested': u.notInterested++; break;
            case 'hired_elsewhere': u.hiredElsewhere++; break;
            case 'not_qualified': u.notQualified++; break;
            case 'wrong_number': u.wrongNumber++; break;
            case 'voicemail': case 'no_answer': u.voicemail++; break;
            default: break;
        }
    }

    return stats;
}

function toDateKey(ts) {
    let d;
    if (ts && typeof ts.toDate === 'function') d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    else d = new Date();
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
}

function isCompanyLeadActivityPath(path, companyId) {
    if (!path.startsWith(`companies/${companyId}/`)) return false;
    return path.includes('/applications/') || path.includes('/leads/');
}

/**
 * Cost-optimized reader for company activity documents.
 * Uses collection-group scans with documentId range + pagination to avoid
 * N+1 parent collection scans.
 */
async function accumulateByDayFromCollectionGroup(companyId, collectionName, byDay) {
    const documentId = admin.firestore.FieldPath.documentId();
    const prefix = `companies/${companyId}/`;
    const upperBound = `${prefix}\uf8ff`;

    let total = 0;
    let lastDoc = null;

    let hasMore = true;
    while (hasMore) {
        let query = db
            .collectionGroup(collectionName)
            .where(documentId, '>=', prefix)
            .where(documentId, '<', upperBound)
            .orderBy(documentId)
            .limit(COLLECTION_GROUP_PAGE_SIZE);

        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snap = await query.get();
        if (snap.empty) break;

        for (const d of snap.docs) {
            if (!isCompanyLeadActivityPath(d.ref.path, companyId)) continue;
            const dk = toDateKey(d.data().timestamp);
            if (!byDay[dk]) byDay[dk] = [];
            byDay[dk].push(d);
            total++;
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        hasMore = snap.size === COLLECTION_GROUP_PAGE_SIZE;
    }

    return total;
}

/**
 * Process one company: collect all call activities, group by day, write stats_daily.
 */
async function processCompany(companyId, dryRun) {
    const byDay = {}; // dateKey -> [snapshots]
    const modernCount = await accumulateByDayFromCollectionGroup(companyId, 'activity_logs', byDay);
    const legacyCount = await accumulateByDayFromCollectionGroup(companyId, 'activities', byDay);

    const preview = [];
    let daysWritten = 0;

    const sortedDays = Object.keys(byDay).sort();
    for (const dateKey of sortedDays) {
        const stats = buildDayStats(byDay[dateKey]);
        if (stats.totalDials === 0) continue;

        preview.push({
            dateKey,
            totalDials: stats.totalDials,
            connected: stats.connected,
            userCount: Object.keys(stats.byUser).length,
        });

        if (!dryRun) {
            const statsRef = db.collection('companies').doc(companyId)
                .collection('stats_daily').doc(dateKey);
            await statsRef.set({
                ...stats,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                backfilledAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            daysWritten++;
        }
    }

    return {
        companyId,
        totalActivitiesProcessed: legacyCount + modernCount,
        legacyCount,
        modernCount,
        daysWithStats: preview.length,
        daysWritten: dryRun ? 0 : daysWritten,
        dryRun,
        preview: preview.slice(0, 30),
    };
}

/**
 * Backfill stats for a single company (super-admin only).
 */
exports.backfillCompanyStats = onCall(
    { cors: true, timeoutSeconds: 540, memory: '512MiB' },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

        // Only super admins can run backfills
        const userRecord = await admin.auth().getUser(request.auth.uid);
        const claims = userRecord.customClaims || {};
        if (!hasSuperAdminRole(claims)) {
            throw new HttpsError('permission-denied', 'Super admin access required.');
        }

        const { companyId, dryRun = true } = request.data || {};
        if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');

        // Rate limit: max 5 backfill runs per hour per user
        const isAllowed = await checkRateLimit(`backfill_${request.auth.uid}`, 5, 3600, 'closed');
        if (!isAllowed) throw new HttpsError('resource-exhausted', 'Too many backfill requests. Please wait.');

        console.log(`[Backfill] Starting ${dryRun ? 'dry-run' : 'LIVE'} for company ${companyId}`);
        const result = await processCompany(companyId, dryRun);
        console.log(`[Backfill] Complete: ${JSON.stringify({ ...result, preview: `[${result.preview.length} days]` })}`);
        return result;
    }
);

/**
 * Backfill stats for ALL companies (super-admin only).
 */
exports.backfillAllStats = onCall(
    { cors: true, timeoutSeconds: 540, memory: '1GiB' },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

        // Only super admins can run bulk backfills
        const userRecord = await admin.auth().getUser(request.auth.uid);
        const claims = userRecord.customClaims || {};
        if (!hasSuperAdminRole(claims)) {
            throw new HttpsError('permission-denied', 'Super admin access required.');
        }

        const { dryRun = true } = request.data || {};

        // Rate limit: max 2 all-company backfills per hour
        const isAllowed = await checkRateLimit(`backfill_all_${request.auth.uid}`, 2, 3600, 'closed');
        if (!isAllowed) throw new HttpsError('resource-exhausted', 'Too many backfill requests. Please wait.');

        const companiesSnap = await db.collection('companies').get();
        const results = [];
        let totalActivitiesProcessed = 0;
        let companiesSucceeded = 0;

        for (const companyDoc of companiesSnap.docs) {
            try {
                const result = await processCompany(companyDoc.id, dryRun);
                results.push({ companyId: companyDoc.id, ...result });
                totalActivitiesProcessed += result.totalActivitiesProcessed;
                companiesSucceeded++;
            } catch (err) {
                console.error(`[BackfillAll] Failed for ${companyDoc.id}:`, err.message);
                results.push({ companyId: companyDoc.id, error: err.message });
            }
        }

        return {
            dryRun,
            companiesProcessed: companiesSnap.size,
            companiesSucceeded,
            totalActivitiesProcessed,
            results,
        };
    }
);
