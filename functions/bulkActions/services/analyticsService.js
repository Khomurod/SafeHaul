const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");
const { buildLeadQueries } = require("../helpers/queryBuilder");
const { assertCompanyAdmin } = require("../helpers/auth");
const { normalizePhone } = require("../../utils/phoneUtils");

const cors = require("cors")({ origin: true });

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
            const idPhoneMap = new Map(); // leadId -> normalizedPhone
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
                        const normPhone = normalizePhone(rawPhone);
                        if (normPhone && normPhone.length >= 10 && normPhone.length <= 11) {
                            idPhoneMap.set(d.id, normPhone);
                        }
                    }
                });
            });
            console.log(`[getFilterCount v3] TOTAL docs: ${totalDocs}, Excluded by timestamp: ${excludedByTimestamp}, Remaining: ${idSet.size}, Phone map: ${idPhoneMap.size}`);

            // --- Secondary Phone Filter: Cross-check against sms_sent_phones ---
            if (idPhoneMap.size > 0) {
                try {
                    const phoneEntries = Array.from(idPhoneMap.entries());
                    const phonesToCheck = [...new Set(phoneEntries.map(e => e[1]))];
                    const recentPhones = new Set();

                    let phoneThresholdTs = null;
                    if (filters.excludeRecentDays !== 'forever') {
                        const days = parseInt(filters.excludeRecentDays) || 7;
                        const thresholdDate = new Date();
                        thresholdDate.setDate(thresholdDate.getDate() - days);
                        phoneThresholdTs = admin.firestore.Timestamp.fromDate(thresholdDate);
                    }

                    for (let i = 0; i < phonesToCheck.length; i += 10) {
                        const chunk = phonesToCheck.slice(i, i + 10);
                        const docRefs = chunk.map(p =>
                            db.collection('companies').doc(companyId)
                                .collection('sms_sent_phones').doc(p)
                        );
                        const phoneSnaps = await db.getAll(...docRefs);
                        phoneSnaps.forEach(snap => {
                            if (!snap.exists) return;
                            const data = snap.data();
                            if (!data.lastSentAt) return;
                            if (phoneThresholdTs === null) {
                                recentPhones.add(snap.id);
                            } else if (data.lastSentAt >= phoneThresholdTs) {
                                recentPhones.add(snap.id);
                            }
                        });
                    }

                    if (recentPhones.size > 0) {
                        for (const [leadId, phone] of phoneEntries) {
                            if (recentPhones.has(phone) && idSet.has(leadId)) {
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

        let leads = [];

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
                const candidatePhoneMap = new Map(); // index -> normalizedPhone
                candidates.forEach((lead, idx) => {
                    const rawPhone = lead.phone || '';
                    const normPhone = normalizePhone(rawPhone);
                    if (normPhone && normPhone.length >= 10 && normPhone.length <= 11) {
                        candidatePhoneMap.set(idx, normPhone);
                    }
                });

                if (candidatePhoneMap.size > 0) {
                    const phonesToCheck = [...new Set(candidatePhoneMap.values())];
                    const sentPhones = new Set();

                    let phoneThresholdTs = null;
                    if (!excludeForever && filters.excludeRecentDays !== 'forever') {
                        const days = parseInt(filters.excludeRecentDays) || 7;
                        const thresholdDate = new Date();
                        thresholdDate.setDate(thresholdDate.getDate() - days);
                        phoneThresholdTs = admin.firestore.Timestamp.fromDate(thresholdDate);
                    }

                    // Batch check phones in chunks of 10
                    for (let i = 0; i < phonesToCheck.length; i += 10) {
                        const chunk = phonesToCheck.slice(i, i + 10);
                        const docRefs = chunk.map(p =>
                            db.collection('companies').doc(companyId)
                                .collection('sms_sent_phones').doc(p)
                        );
                        const phoneSnaps = await db.getAll(...docRefs);
                        phoneSnaps.forEach(s => {
                            if (!s.exists) return;
                            const sData = s.data();
                            if (!sData.lastSentAt) return;
                            if (phoneThresholdTs === null) {
                                sentPhones.add(s.id);
                            } else if (sData.lastSentAt >= phoneThresholdTs) {
                                sentPhones.add(s.id);
                            }
                        });
                    }

                    // Remove candidates whose phone was found in sms_sent_phones
                    if (sentPhones.size > 0) {
                        const excludeIndices = new Set();
                        for (const [idx, phone] of candidatePhoneMap.entries()) {
                            if (sentPhones.has(phone)) {
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
    if (!Array.isArray(phones) || phones.length === 0) return { excludedPhones: [] };
    if (!excludeRecentDays || excludeRecentDays === 'off') return { excludedPhones: [] };

    // Build threshold timestamp (same logic as sessionController.js)
    let thresholdTs = null; // null = 'forever' — exclude ANY previously messaged phone
    if (excludeRecentDays !== 'forever') {
        const days = parseInt(excludeRecentDays);
        if (!isNaN(days) && days > 0) {
            const date = new Date();
            date.setDate(date.getDate() - days);
            thresholdTs = admin.firestore.Timestamp.fromDate(date);
        }
    }

    const excludedPhones = [];

    // Query sms_sent_phones in batches of 10 (Firestore getAll limit per call is fine, but keep chunks manageable)
    for (let i = 0; i < phones.length; i += 10) {
        const chunk = phones.slice(i, i + 10);
        const docRefs = chunk.map(p =>
            db.collection('companies').doc(companyId).collection('sms_sent_phones').doc(p)
        );

        try {
            const snapshots = await db.getAll(...docRefs);
            snapshots.forEach(snap => {
                if (!snap.exists) return;
                const data = snap.data();
                if (!data.lastSentAt) return;

                if (thresholdTs === null) {
                    // 'forever' mode: exclude any phone that has ever been messaged
                    excludedPhones.push(snap.id);
                } else {
                    // Time-based: exclude if messaged on or after the threshold
                    if (data.lastSentAt >= thresholdTs) {
                        excludedPhones.push(snap.id);
                    }
                }
            });
        } catch (chunkErr) {
            console.error('[checkImportPhones] Chunk lookup error:', chunkErr);
            // Non-fatal: skip this chunk, don't block the user
        }
    }

    return { excludedPhones };
});
