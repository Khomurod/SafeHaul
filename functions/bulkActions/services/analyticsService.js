const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");
const { buildLeadQueries } = require("../helpers/queryBuilder");
const { assertCompanyAdmin } = require("../helpers/auth");
const {
    derivePhoneLedgerKeys,
    buildSmsLedgerThreshold,
    findRecentlyMessagedCanonicalPhones,
} = require("../helpers/phoneLedger");

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

        // If Exclude filter is active, we must fetch data to filter in-memory (to handle missing fields)
        if (filters.excludeRecentDays && filters.excludeRecentDays !== 'off') {
            let excludeThreshold = null; // null means 'forever' — exclude ANY previously messaged
            if (filters.excludeRecentDays !== 'forever') {
                const days = parseInt(filters.excludeRecentDays);
                if (!isNaN(days) && days > 0) {
                    const date = new Date();
                    date.setDate(date.getDate() - days);
                    excludeThreshold = admin.firestore.Timestamp.fromDate(date);
                }
            }

            // Fetch needed fields (phone for secondary sms_sent_phones check)
            const snapshots = await Promise.all(queries.map(q => q.select('lastBulkMessageAt', 'lastContactedAt', 'phone', 'phoneNumber').get()));

            let totalDocs = 0;
            let excludedByTimestamp = 0;
            const idSet = new Set();
            const idPhoneMap = new Map(); // leadId -> canonical phone
            snapshots.forEach(snap => {
                snap.docs.forEach(d => {
                    totalDocs++;
                    const data = d.data();
                    let include = true;
                    // Check BOTH lastBulkMessageAt (new system) and lastContactedAt (old system)
                    const messageTs = data.lastBulkMessageAt || data.lastContactedAt || null;
                    if (excludeThreshold === null) {
                        // 'forever' mode: exclude if ANY message timestamp exists
                        if (messageTs) {
                            include = false;
                            excludedByTimestamp++;
                        }
                    } else {
                        // Time-based: include if no timestamp OR date is OLD (< threshold)
                        if (messageTs && messageTs >= excludeThreshold) {
                            include = false;
                            excludedByTimestamp++;
                        }
                    }
                    if (include) {
                        idSet.add(d.id);
                        // Track phone for secondary check
                        const rawPhone = data.phone || data.phoneNumber || '';
                        const { canonical } = derivePhoneLedgerKeys(rawPhone);
                        if (canonical) idPhoneMap.set(d.id, canonical);
                    }
                });
            });
            console.log(`[getFilterCount v3] TOTAL docs: ${totalDocs}, Excluded by timestamp: ${excludedByTimestamp}, Remaining: ${idSet.size}, Phone map: ${idPhoneMap.size}`);

            // --- Secondary Phone Filter: Cross-check against sms_sent_phones ---
            if (idPhoneMap.size > 0) {
                try {
                    const phoneEntries = Array.from(idPhoneMap.entries());
                    const phoneThresholdTs = buildSmsLedgerThreshold(filters.excludeRecentDays);
                    const recentCanonicals = await findRecentlyMessagedCanonicalPhones({
                        db,
                        companyId,
                        canonicalPhones: phoneEntries.map((e) => e[1]),
                        thresholdTs: phoneThresholdTs,
                    });

                    if (recentCanonicals.size > 0) {
                        for (const [leadId, phone] of phoneEntries) {
                            if (recentCanonicals.has(phone) && idSet.has(leadId)) {
                                idSet.delete(leadId);
                            }
                        }
                    }
                } catch (phoneErr) {
                    console.error('[getFilterCount] sms_sent_phones check error (proceeding without):', phoneErr);
                }
            }

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

        let excludeThreshold = null;
        let excludeForever = false;
        if (filters.excludeRecentDays) {
            if (filters.excludeRecentDays === 'forever') {
                excludeForever = true;
            } else {
                const days = parseInt(filters.excludeRecentDays);
                if (!isNaN(days) && days > 0) {
                    const date = new Date();
                    date.setDate(date.getDate() - days);
                    excludeThreshold = admin.firestore.Timestamp.fromDate(date);
                }
            }
        }

        // First pass: collect candidates that pass timestamp filter
        const candidates = [];
        for (const d of snap.docs) {
            const data = d.data();

            // Check BOTH lastBulkMessageAt (new system) and lastContactedAt (old system)
            const messageTs = data.lastBulkMessageAt || data.lastContactedAt || null;

            // In-Memory Filter: Exclude Recent / Forever
            if (excludeForever) {
                if (messageTs) continue; // Skip any previously messaged
            } else if (excludeThreshold) {
                if (messageTs && messageTs >= excludeThreshold) {
                    continue; // Skip this lead
                }
            }

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

        // Second pass: sms_sent_phones cross-check (only if exclude filter is active)
        if ((excludeForever || excludeThreshold) && candidates.length > 0) {
            try {
                // Build phone map for candidates
                const candidatePhoneMap = new Map(); // index -> canonical phone
                candidates.forEach((lead, idx) => {
                    const rawPhone = lead.phone || '';
                    const { canonical } = derivePhoneLedgerKeys(rawPhone);
                    if (canonical) candidatePhoneMap.set(idx, canonical);
                });

                if (candidatePhoneMap.size > 0) {
                    const phoneThresholdTs = buildSmsLedgerThreshold(filters.excludeRecentDays);
                    const sentCanonicals = await findRecentlyMessagedCanonicalPhones({
                        db,
                        companyId,
                        canonicalPhones: [...candidatePhoneMap.values()],
                        thresholdTs: phoneThresholdTs,
                    });

                    // Remove candidates whose phone was found in sms_sent_phones
                    if (sentCanonicals.size > 0) {
                        const excludeIndices = new Set();
                        for (const [idx, phone] of candidatePhoneMap.entries()) {
                            if (sentCanonicals.has(phone)) {
                                excludeIndices.add(idx);
                            }
                        }
                        // Filter out excluded candidates
                        const filtered = candidates.filter((_, idx) => !excludeIndices.has(idx));
                        console.log(`[getFilteredLeadsPage v3] Candidates: ${candidates.length}, Phone excluded: ${excludeIndices.size}, Final: ${filtered.length}`);
                        return { leads: filtered.slice(0, limit) };
                    }
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
    if (!excludeRecentDays || excludeRecentDays === 'off') return { excludedPhones: [] };

    const thresholdTs = buildSmsLedgerThreshold(excludeRecentDays);

    const inputToCanonical = new Map();
    phones.forEach((phone) => {
        const { canonical } = derivePhoneLedgerKeys(phone);
        if (canonical) inputToCanonical.set(phone, canonical);
    });
    if (inputToCanonical.size === 0) return { excludedPhones: [] };

    try {
        const excludedCanonicals = await findRecentlyMessagedCanonicalPhones({
            db,
            companyId,
            canonicalPhones: [...new Set(inputToCanonical.values())],
            thresholdTs,
        });

        const excludedPhones = [...new Set(
            phones.filter((phone) => {
                const canonical = inputToCanonical.get(phone);
                return canonical && excludedCanonicals.has(canonical);
            })
        )];

        return { excludedPhones };
    } catch (chunkErr) {
        console.error('[checkImportPhones] Chunk lookup error:', chunkErr);
        return { excludedPhones: [] };
    }
});
