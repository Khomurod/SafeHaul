const { HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");
const { APPLICATION_STATUSES, LAST_CALL_RESULTS, getDbValue } = require("../../shared/constants");

/**
 * HELPER: Safely convert any date value to a Firestore Timestamp.
 * Handles: ISO strings, epoch numbers, Firestore Timestamps, and Date objects.
 * Returns null if the value cannot be converted.
 */
const safeToTimestamp = (val) => {
    if (!val) return null;
    try {
        // Already a Firestore Timestamp
        if (typeof val.toDate === 'function') {
            const d = val.toDate();
            if (isNaN(d.getTime())) return null;
            return val;
        }
        // Already a Date object
        if (val instanceof Date) {
            if (isNaN(val.getTime())) return null;
            const seconds = Math.floor(val.getTime() / 1000);
            return new admin.firestore.Timestamp(seconds, 0);
        }
        // Epoch milliseconds (number)
        if (typeof val === 'number') {
            if (isNaN(val)) return null;
            const seconds = Math.floor(val / 1000);
            return new admin.firestore.Timestamp(seconds, 0);
        }
        // ISO string or any other string
        const d = new Date(val);
        if (isNaN(d.getTime())) return null;
        const seconds = Math.floor(d.getTime() / 1000);
        return new admin.firestore.Timestamp(seconds, 0);
    } catch (e) {
        console.warn(`safeToTimestamp: Failed to convert value "${val}":`, e.message);
        return null;
    }
};

/**
 * HELPER: Build Shared Firestore Queries (Split Strategy)
 * Returns an ARRAY of queries to handle OR conditions without specialized indexes.
 */
const buildLeadQueries = (companyId, filters, userId) => {
    let baseRef;
    if (filters.leadType === 'leads') {
        baseRef = db.collection('companies').doc(companyId).collection('leads');
    } else {
        baseRef = db.collection('companies').doc(companyId).collection('applications');
    }

    // Start with one base query
    let queries = [baseRef];

    // Helper to apply simple filter to all queries
    const applyToAll = (fn) => {
        queries = queries.map(q => fn(q));
    };

    // Helper to split queries (OR logic)
    // fn1 and fn2 take a query and return a modified query
    const splitQueries = (fn1, fn2) => {
        queries = queries.flatMap(q => [fn1(q), fn2(q)]);
    };

    // 1. Status Filter
    if (filters.status && filters.status.length > 0 && filters.status !== 'all') {
        const mapStatus = (s) => getDbValue(s, APPLICATION_STATUSES);
        if (Array.isArray(filters.status)) {
            if (filters.status.length > 30) throw new HttpsError('invalid-argument', 'Max 30 status filters allowed.');
            const dbStatuses = filters.status.map(mapStatus);
            applyToAll(q => q.where('status', 'in', dbStatuses));
        } else {
            const dbStatus = mapStatus(filters.status);
            applyToAll(q => q.where('status', '==', dbStatus));
        }
    }

    // 2. Recruiter Filter
    if (filters.recruiterId === 'my_leads') {
        applyToAll(q => q.where('assignedTo', '==', userId));
    } else if (filters.recruiterId && filters.recruiterId !== 'all') {
        applyToAll(q => q.where('assignedTo', '==', filters.recruiterId));
    }

    // 3. Date Filters
    if (filters.createdAfter) {
        const ts = safeToTimestamp(filters.createdAfter);
        if (ts) {
            console.log(`DEBUG QueryBuilder: Applying createdAfter >= ${ts.toDate().toISOString()}`);
            applyToAll(q => q.where('createdAt', '>=', ts));
        } else {
            console.warn(`DEBUG QueryBuilder: Invalid createdAfter value (skipped):`, filters.createdAfter);
        }
    }
    if (filters.createdBefore) {
        const ts = safeToTimestamp(filters.createdBefore);
        if (ts) {
            console.log(`DEBUG QueryBuilder: Applying createdBefore <= ${ts.toDate().toISOString()}`);
            applyToAll(q => q.where('createdAt', '<=', ts));
        } else {
            console.warn(`DEBUG QueryBuilder: Invalid createdBefore value (skipped):`, filters.createdBefore);
        }
    }

    // 4. "Not Contacted Since" (Legacy/Manual)
    if (filters.notContactedSince) {
        const days = parseInt(filters.notContactedSince);
        if (!isNaN(days)) {
            const d = new Date();
            d.setDate(d.getDate() - days);

            // Safe creation
            if (!isNaN(d.getTime())) {
                const seconds = Math.floor(d.getTime() / 1000);
                const threshold = new admin.firestore.Timestamp(seconds, 0);
                console.log(`DEBUG QueryBuilder: Applying notContactedSince <= ${threshold.toDate().toISOString()} (Seconds: ${seconds})`);

                // Split: (lastContacted <= threshold) OR (lastContacted == null)
                splitQueries(
                    q => q.where('lastContactedAt', '<=', threshold),
                    q => q.where('lastContactedAt', '==', null)
                );
            }
        }
    }


    // 5. Exclude Recent Bulk Messages (New Spam Prevention)
    // NOTE: Moved to in-memory filtering in sessionController.js to handle missing fields correctly.
    // if (filters.excludeRecentDays) { ... }


    // 6. Campaign Limit
    if (filters.campaignLimit) {
        const limit = parseInt(filters.campaignLimit);
        if (!isNaN(limit) && limit > 0) {
            console.log(`DEBUG QueryBuilder: Applying limit ${limit}`);
            applyToAll(q => q.limit(limit));
        }
    }

    // 7. Last Call Outcome
    if (filters.lastCallOutcome && filters.lastCallOutcome !== 'all') {
        const dbOutcome = getDbValue(filters.lastCallOutcome, LAST_CALL_RESULTS);
        applyToAll(q => q.where('lastCallOutcome', '==', dbOutcome));
    }

    return queries;
};

module.exports = { buildLeadQueries };
