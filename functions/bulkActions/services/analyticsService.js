const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("../../firebaseAdmin");
const { buildLeadQueries } = require("../helpers/queryBuilder");
const { assertCompanyAdmin } = require("../helpers/auth");
const {
    excludeWindow,
    leadMessagedWithin,
    recipientsMessagedWithin,
} = require("../helpers/recentlyMessaged");

/**
 * Safely convert a Firestore Timestamp, Date, string, or number to an ISO string.
 * Returns null if the value is falsy or cannot be converted.
 */
const safeToISO = (val) => {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate().toISOString();
    if (val instanceof Date) return val.toISOString();
    try { return new Date(val).toISOString(); } catch { return null; }
};

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

        // With an exclusion window the documents are read, not counted, so each
        // lead's own stamps and the SMS ledger can be checked (`recentlyMessaged`).
        const window = excludeWindow(filters?.excludeRecentDays);
        if (window.active) {
            const snapshots = await Promise.all(queries.map(q => q.select('lastBulkMessageAt', 'lastContactedAt', 'phone', 'phoneNumber').get()));

            const candidates = new Map(); // leadId -> phone
            snapshots.forEach(snap => {
                snap.docs.forEach(d => {
                    const data = d.data();
                    if (leadMessagedWithin(data, window)) return;
                    candidates.set(d.id, data.phone || data.phoneNumber || '');
                });
            });

            let messaged = new Set();
            try {
                messaged = await recipientsMessagedWithin({
                    db,
                    companyId,
                    window,
                    recipients: [...candidates].map(([key, phone]) => ({ key, phone })),
                });
            } catch (phoneErr) {
                console.error('[getFilterCount] sms_sent_phones check error (proceeding without):', phoneErr);
            }

            total = candidates.size - messaged.size;

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

        // First pass: leave out the leads whose own stamps fall inside the window.
        const window = excludeWindow(filters?.excludeRecentDays);
        const candidates = [];
        for (const d of snap.docs) {
            const data = d.data();
            if (leadMessagedWithin(data, window)) continue;

            candidates.push({
                id: d.id,
                firstName: data.firstName,
                lastName: data.lastName,
                phone: data.phone || data.phoneNumber,
                email: data.email,
                status: data.status,
                createdAt: safeToISO(data.createdAt),
                lastContactedAt: safeToISO(data.lastContactedAt)
            });
        }

        // Second pass: the SMS ledger, for numbers messaged without a lead stamp.
        if (window.active && candidates.length > 0) {
            try {
                const messaged = await recipientsMessagedWithin({
                    db,
                    companyId,
                    window,
                    recipients: candidates.map((lead) => ({ key: lead.id, phone: lead.phone })),
                });
                if (messaged.size > 0) {
                    const filtered = candidates.filter((lead) => !messaged.has(lead.id));
                    console.log(`[getFilteredLeadsPage v3] Candidates: ${candidates.length}, Phone excluded: ${candidates.length - filtered.length}, Final: ${filtered.length}`);
                    return { leads: filtered.slice(0, limit) };
                }
            } catch (phoneErr) {
                console.error('[getFilteredLeadsPage] sms_sent_phones check error (proceeding without):', phoneErr);
            }
        }

        return { leads: candidates.slice(0, limit) };

    } catch (err) {
        console.error("Preview Error:", err);
        throw new HttpsError('internal', err.message);
    }
});

/**
 * Check which imported phone numbers have already been messaged.
 * Used by the frontend preview to grey out / exclude already-messaged contacts
 * before the user launches the campaign.
 *
 * @param {string}   companyId        - The company to check against
 * @param {string[]} phones           - Array of NORMALIZED phone strings (digits only)
 * @param {string}   excludeRecentDays - 'forever' | '7' | '14' | '30' | 'off'
 * @returns {{ excludedPhones: string[] }}
 */
exports.checkImportPhones = onCall({ cors: true, memory: '256MiB' }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    const { companyId, phones, excludeRecentDays } = request.data;
    if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');
    await assertCompanyAdmin(request.auth.uid, companyId);
    if (!Array.isArray(phones) || phones.length === 0) return { excludedPhones: [] };

    const window = excludeWindow(excludeRecentDays);
    if (!window.active) return { excludedPhones: [] };

    try {
        // Each phone is its own recipient key, so the answer lists the phones as sent.
        const messaged = await recipientsMessagedWithin({
            db,
            companyId,
            window,
            recipients: phones.map((phone) => ({ key: phone, phone })),
        });
        return { excludedPhones: [...messaged] };
    } catch (chunkErr) {
        console.error('[checkImportPhones] Chunk lookup error:', chunkErr);
        return { excludedPhones: [] };
    }
});
