const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");
const { APPLICATION_STATUSES, LAST_CALL_RESULTS, getDbValue } = require("../../shared/constants");

/**
 * HELPER: Build Shared Firestore Queries (Split Strategy)
 * Returns an ARRAY of queries to handle OR conditions without specialized indexes.
 */
const buildLeadQueries = (companyId, filters, userId) => {
    let baseRef;
    if (filters.leadType === 'global') {
        baseRef = db.collection('leads');
    } else if (filters.leadType === 'leads') {
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
        applyToAll(q => q.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(filters.createdAfter))));
    }
    if (filters.createdBefore) {
        applyToAll(q => q.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(new Date(filters.createdBefore))));
    }

    // 4. "Not Contacted Since" (Legacy/Manual)
    if (filters.notContactedSince) {
        const days = parseInt(filters.notContactedSince);
        const date = new Date();
        date.setDate(date.getDate() - days);
        const threshold = admin.firestore.Timestamp.fromDate(date);

        // Split: (lastContacted <= threshold) OR (lastContacted == null)
        splitQueries(
            q => q.where('lastContactedAt', '<=', threshold),
            q => q.where('lastContactedAt', '==', null)
        );
    }


    // 5. Exclude Recent Bulk Messages (New Spam Prevention)
    // NOTE: Moved to in-memory filtering in sessionController.js to handle missing fields correctly.
    // if (filters.excludeRecentDays) { ... }


    // 6. Last Call Outcome
    if (filters.lastCallOutcome && filters.lastCallOutcome !== 'all') {
        if (filters.leadType === 'global') {
            const outcomeMap = {
                "Connected / Interested": "interested",
                "Connected / Scheduled Callback": "callback",
                "Connected / Not Qualified": "not_qualified",
                "Connected / Not Interested": "not_interested",
                "Connected / Hired Elsewhere": "hired_elsewhere",
                "Left Voicemail": "voicemail",
                "No Answer": "no_answer",
                "Wrong Number": "wrong_number"
            };
            const outcomeId = outcomeMap[filters.lastCallOutcome] || filters.lastCallOutcome;
            applyToAll(q => q.where('lastOutcome', '==', outcomeId));
        } else {
            const dbOutcome = getDbValue(filters.lastCallOutcome, LAST_CALL_RESULTS);
            applyToAll(q => q.where('lastCallOutcome', '==', dbOutcome));
        }
    }

    return queries;
};

module.exports = { buildLeadQueries };
