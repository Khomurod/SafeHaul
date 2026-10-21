const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("../../firebaseAdmin");
const { buildLeadQueries } = require("../helpers/queryBuilder");
const { assertCompanyAdmin } = require("../helpers/auth");
const {
    excludeWindow,
    recipientsMessagedWithin,
} = require("../helpers/recentlyMessaged");

// A campaign's channel. A caller that names none (an older screen) counts for SMS.
const methodOf = (request) => (request.data?.method === 'email' ? 'email' : 'sms');

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
    const method = methodOf(request);

    // RBAC
    await assertCompanyAdmin(request.auth.uid, companyId);

    // Build Queries
    const queries = buildLeadQueries(companyId, filters || {}, request.auth.uid);

    // Run Count Aggregation. The answer says how many the window left out:
    // `alreadyMessaged`, recipients a campaign of this channel reached.
    try {
        let total = 0;
        let alreadyMessaged = 0;

        // With an exclusion window the documents are read, not counted, so the
        // channel's ledger can be checked (`recentlyMessaged`).
        const window = excludeWindow(filters?.excludeRecentDays);
        if (window.active) {
            const snapshots = await Promise.all(queries.map(q => q.select('phone', 'phoneNumber', 'email').get()));

            const candidates = new Map(); // leadId -> { key, phone, email }
            snapshots.forEach(snap => {
                snap.docs.forEach(d => {
                    const data = d.data();
                    candidates.set(d.id, { key: d.id, phone: data.phone || data.phoneNumber || '', email: data.email });
                });
            });

            const messaged = await recipientsMessagedWithin({
                db,
                companyId,
                window,
                method,
                recipients: [...candidates.values()],
            });
            alreadyMessaged = messaged.size;
            total = candidates.size - messaged.size;

        } else {
            // Fast Server-Side Count
            const counts = await Promise.all(queries.map(async (q) => {
                const snap = await q.count().get();
                return snap.data().count;
            }));
            total = counts.reduce((a, b) => a + b, 0);
        }

        return { count: total, alreadyMessaged };

    } catch (err) {
        console.error("Filter Count Error:", err);
        throw new HttpsError('internal', err.message);
    }
});

exports.getFilteredLeadsPage = onCall({ cors: true, memory: '512MiB' }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    const { companyId, filters, pageSize, lastDocId } = request.data;
    const limit = Math.min(pageSize || 50, 100);
    const method = methodOf(request);

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

        const window = excludeWindow(filters?.excludeRecentDays);
        const candidates = [];
        for (const d of snap.docs) {
            const data = d.data();
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

        // Then the channel's ledger: who a campaign of this channel reached.
        const messaged = await recipientsMessagedWithin({
            db,
            companyId,
            window,
            method,
            recipients: candidates.map((lead) => ({ key: lead.id, phone: lead.phone, email: lead.email })),
        });
        return { leads: candidates.filter((lead) => !messaged.has(lead.id)).slice(0, limit) };

    } catch (err) {
        console.error("Preview Error:", err);
        throw new HttpsError('internal', err.message);
    }
});

/**
 * Which uploaded rows a campaign of the same channel already reached inside
 * the window. The upload preview greys them out and the count leaves them out.
 *
 * @param {string}   companyId         - The company to check against
 * @param {Array<{key: string, phone?: string, email?: string}>} recipients - the rows, each by its key
 * @param {string}   [method]          - 'sms' | 'email'; SMS when none is named
 * @param {string}   excludeRecentDays - 'forever' | '7' | '14' | '30' | 'off'
 * @returns {{ excludedKeys: string[] }}
 *
 * An older screen sends `phones` (normalized numbers) instead and is answered
 * `{ excludedPhones }`, for SMS.
 */
exports.checkImportPhones = onCall({ cors: true, memory: '256MiB' }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    const { companyId, phones, recipients, excludeRecentDays } = request.data;
    if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');
    await assertCompanyAdmin(request.auth.uid, companyId);

    const byPhone = !Array.isArray(recipients);
    const rows = byPhone
        ? (Array.isArray(phones) ? phones : []).map((phone) => ({ key: phone, phone }))
        : recipients
            .filter((row) => row && typeof row.key === 'string')
            .map(({ key, phone, email }) => ({ key, phone: String(phone || ''), email: String(email || '') }));
    const answer = (keys) => (byPhone ? { excludedPhones: keys } : { excludedKeys: keys });

    const window = excludeWindow(excludeRecentDays);
    if (!window.active || rows.length === 0) return answer([]);

    const messaged = await recipientsMessagedWithin({
        db,
        companyId,
        window,
        method: byPhone ? 'sms' : methodOf(request),
        recipients: rows,
    });
    return answer([...messaged]);
});
