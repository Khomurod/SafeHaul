const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");
const { buildLeadQueries } = require("../helpers/queryBuilder");
const { assertCompanyAdmin } = require("../helpers/auth");

const cors = require("cors")({ origin: true });

exports.getFilterCount = onCall({ cors: true, memory: '512MiB' }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    const { companyId, filters } = request.data;
    if (!companyId) throw new HttpsError('invalid-argument', 'Company ID is required.');

    // RBAC
    await assertCompanyAdmin(request.auth.uid, companyId);

    // Build Queries
    const queries = buildLeadQueries(companyId, filters || {}, request.auth.uid);

    // Run Count Aggregation
    try {
        let total = 0;

        // If Exclude Recent is active, we must fetch data to filter in-memory (to handle missing fields)
        if (filters.excludeRecentDays) {
            const days = parseInt(filters.excludeRecentDays);
            const date = new Date();
            date.setDate(date.getDate() - days);
            const excludeThreshold = admin.firestore.Timestamp.fromDate(date);

            // Fetch only needed field to save bandwidth
            const snapshots = await Promise.all(queries.map(q => q.select('lastBulkMessageAt').get()));

            const idSet = new Set();
            snapshots.forEach(snap => {
                snap.docs.forEach(d => {
                    const data = d.data();
                    // Include if field is missing OR date is OLD (< threshold)
                    // Exclude if field exists AND date is RECENT (>= threshold)
                    if (!data.lastBulkMessageAt || data.lastBulkMessageAt < excludeThreshold) {
                        idSet.add(d.id);
                    }
                });
            });
            total = idSet.size;

        } else {
            // Fast Server-Side Count
            const counts = await Promise.all(queries.map(async (q) => {
                const snap = await q.count().get();
                return snap.data().count;
            }));
            total = counts.reduce((a, b) => a + b, 0);
        }

        return { count: total };

    } catch (err) {
        console.error("Filter Count Error:", err);
        throw new HttpsError('internal', err.message);
    }
});

exports.getFilteredLeadsPage = onCall({ cors: true, memory: '512MiB' }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    const { companyId, filters, pageSize, lastDocId } = request.data;
    const limit = Math.min(pageSize || 50, 100);

    // RBAC
    await assertCompanyAdmin(request.auth.uid, companyId);

    // NOTE: Pagination with split queries (OR logic) is complex.
    // Simplifying: If multiple queries (OR), we just execute the first one for preview,
    // or we fetch from all and merge (costly).
    // For Preview: We will prioritize the first query match.
    // Ideally, UI should avoid complex 'OR' filters for preview if possible.

    const queries = buildLeadQueries(companyId, filters || {}, request.auth.uid);

    try {
        // We only take the first query for preview if split, to avoid complexity (User agreed to this limitation in V1)
        // Or we warn the user.
        // Actually, let's try to simple fetch.
        let mainQuery = queries[0];

        // Apply ordering (Default: CreatedAt desc)
        mainQuery = mainQuery.orderBy('createdAt', 'desc');

        if (lastDocId) {
            // ... cursor logic omitted for preview ...
        }

        // Fetch larger batch to allow for in-memory filtering
        // We fetch 3x the limit to try and fill the page after exclusions
        const fetchLimit = limit * 3;
        const snap = await mainQuery.limit(fetchLimit).get();

        let leads = [];

        let excludeThreshold = null;
        if (filters.excludeRecentDays) {
            const days = parseInt(filters.excludeRecentDays);
            const date = new Date();
            date.setDate(date.getDate() - days);
            excludeThreshold = admin.firestore.Timestamp.fromDate(date);
        }

        for (const d of snap.docs) {
            if (leads.length >= limit) break; // Filled the page

            const data = d.data();

            // In-Memory Filter: Exclude Recent
            if (excludeThreshold) {
                if (data.lastBulkMessageAt && data.lastBulkMessageAt >= excludeThreshold) {
                    continue; // Skip this lead
                }
            }

            leads.push({
                id: d.id,
                firstName: data.firstName,
                lastName: data.lastName,
                phone: data.phone || data.phoneNumber,
                email: data.email,
                status: data.status,
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
                lastContactedAt: data.lastContactedAt ? data.lastContactedAt.toDate().toISOString() : null
            });
        }

        return { leads };

    } catch (err) {
        console.error("Preview Error:", err);
        throw new HttpsError('internal', err.message);
    }
});
