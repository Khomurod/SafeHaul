// =====================================================================
// Gathering the target IDs for a bulk session.
//
// Two of `initBulkSession`'s three ID-gathering branches, extracted from
// `sessionController.js`. `verifyDirectSelection` is the BULK-2 IDOR
// gate: caller-provided IDs count only if the company's own collections
// contain them. `gatherIdsFromQueries` runs the filter queries and applies
// the recently-messaged exclusion (the campaign channel's ledger,
// sms_sent_phones or email_sent_addresses), by the one rule in
// `helpers/recentlyMessaged.js`.
//
// The import branch does not gather here: its IDs are minted while the
// import is persisted, in `importTargets.js`.
// =====================================================================

const { HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../../firebaseAdmin");
const { buildLeadQueries } = require("../../helpers/queryBuilder");
const { campaignLimitOf, createdMillis } = require("../../helpers/campaignLimit");
const {
    excludeWindow,
    recipientsMessagedWithin,
} = require("../../helpers/recentlyMessaged");

/**
 * Verifies caller-provided target IDs against the company's own collections
 * and returns only the IDs that belong to it.
 */
const verifyDirectSelection = async ({ companyId, targetIds }) => {
    let finalTargetIds = [];
        // BULK-2 FIX: Verify server-side that each provided lead ID belongs to the specified company.
        // Without this check, an attacker (or misconfigured UI) could pass IDs from another company
        // to exfiltrate data or send SMS to another company's leads (IDOR).
        const maxTargetIds = 500; // Prevent DoS via oversized ID lists
        if (targetIds.length > maxTargetIds) {
            throw new HttpsError('invalid-argument', `Too many targetIds. Maximum is ${maxTargetIds}.`);
        }

        // Determine which collections to check based on leadSourceType
        const collections = ['applications', 'leads'];
        const verifiedIds = new Set();

        for (const collection of collections) {
            const collectionRef = db.collection('companies').doc(companyId).collection(collection);
            // Firestore 'in' queries support max 30 values — batch if necessary
            const chunkSize = 30;
            for (let i = 0; i < targetIds.length; i += chunkSize) {
                const chunk = targetIds.slice(i, i + chunkSize);
                try {
                    const snap = await collectionRef
                        .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
                        .select()  // Only fetch ID, not full document
                        .get();
                    snap.forEach(doc => verifiedIds.add(doc.id));
                } catch (queryErr) {
                    console.warn(`[BULK-2] Ownership check query failed for ${collection}:`, queryErr.message);
                }
            }
        }

        // Filter to only IDs that actually belong to this company
        finalTargetIds = targetIds.filter(id => verifiedIds.has(id));
        const rejectedCount = targetIds.length - finalTargetIds.length;
        if (rejectedCount > 0) {
            console.warn(`[BULK-2] Rejected ${rejectedCount} targetIds not belonging to company ${companyId}`);
        }
        if (finalTargetIds.length === 0) {
            throw new HttpsError('permission-denied', 'None of the provided lead IDs belong to your company.');
        }
    return finalTargetIds;
};

/**
 * Gathers target IDs from the company's lead/application collections by
 * running the filter queries and applying the exclusion filters.
 */
const gatherIdsFromQueries = async ({ companyId, filters, config, authUid }) => {
    // Query Based
    const queries = buildLeadQueries(companyId, filters, authUid);
    console.log(`[BulkSession] Building ${queries.length} queries for company ${companyId}`);

    // Apply .select() to only fetch fields needed for in-memory filtering.
    // This prevents crashes from corrupt Timestamp fields in documents.
    const fieldsNeeded = ['phone', 'phoneNumber', 'email', 'createdAt'];
    const selectQueries = queries.map(q => typeof q.select === 'function' ? q.select(...fieldsNeeded) : q);

    try {
        // Execute sequentially to identify which one fails
        const snapshots = [];
        for (let i = 0; i < selectQueries.length; i++) {
            try {
                const snap = await selectQueries[i].get();
                snapshots.push(snap);
                console.log(`[BulkSession] Query #${i} returned ${snap.size} docs.`);
            } catch (innerErr) {
                console.error(`[BulkSession] Query #${i} failed:`, innerErr.message);
                throw innerErr;
            }
        }

        // The channel's ledger first; the recruiter's un-ticked leads come off last.
        const window = excludeWindow(filters.excludeRecentDays);
        const candidates = new Map(); // leadId -> { key, phone, email, created }
        snapshots.forEach(snap => {
            snap.docs.forEach(d => {
                const data = d.data();
                candidates.set(d.id, {
                    key: d.id,
                    phone: data.phone || data.phoneNumber || '',
                    email: data.email,
                    created: createdMillis(data.createdAt),
                });
            });
        });

        const messaged = await recipientsMessagedWithin({
            db,
            companyId,
            window,
            method: config?.method,
            recipients: [...candidates.values()],
        });
        if (messaged.size > 0) {
            console.log(`[initBulkSession] Already messaged by ${config?.method === 'email' ? 'email' : 'SMS'}: ${messaged.size} leads left out`);
        }

        // Limit Volume takes the newest recipients the exclusion left. As on the
        // screen, the limit comes before the un-ticked leads: un-ticking one
        // lowers the count rather than letting another lead take its place.
        const matches = [...candidates.values()].filter(({ key }) => !messaged.has(key));
        const limit = campaignLimitOf(filters);
        const limited = limit > 0
            ? matches.sort((a, b) => b.created - a.created).slice(0, limit)
            : matches;
        const excludedLeadIds = new Set(filters.excludedLeadIds || []);
        return limited.map(({ key }) => key).filter((id) => !excludedLeadIds.has(id));
    } catch (qErr) {
        throw new HttpsError('internal', `Query execution failed: ${qErr.message}`);
    }
};

module.exports = {
    verifyDirectSelection,
    gatherIdsFromQueries,
};
