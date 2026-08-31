// =====================================================================
// Gathering the target IDs for a bulk session.
//
// Two of `initBulkSession`'s three ID-gathering branches, extracted verbatim
// from `sessionController.js`. `verifyDirectSelection` is the BULK-2 IDOR
// gate: caller-provided IDs count only if the company's own collections
// contain them. `gatherIdsFromQueries` runs the filter queries and applies
// the recently-messaged exclusions (lead timestamps, the sms_sent_phones
// ledger, and the email_sent_addresses ledger).
//
// The import branch does not gather here: its IDs are minted while the
// import is persisted, in `importTargets.js`.
// =====================================================================

const { HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../../firebaseAdmin");
const { buildLeadQueries } = require("../../helpers/queryBuilder");
const {
    derivePhoneLedgerKeys,
    buildSmsLedgerThreshold,
    findRecentlyMessagedCanonicalPhones,
} = require("../../helpers/phoneLedger");

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
    let finalTargetIds = [];
        // Query Based
        const queries = buildLeadQueries(companyId, filters, authUid);
        console.log(`[BulkSession] Building ${queries.length} queries for company ${companyId}`);

        // Apply .select() to only fetch fields needed for in-memory filtering.
        // This prevents crashes from corrupt Timestamp fields in documents.
        const fieldsNeeded = ['lastBulkMessageAt', 'lastContactedAt', 'phone', 'phoneNumber', 'email'];
        const selectQueries = queries.map(q => typeof q.select === 'function' ? q.select(...fieldsNeeded) : q);

        // Execute all queries to get IDs
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

            const idSet = new Set();
            // Map: leadId -> canonical phone (for secondary sms_sent_phones check)
            const idPhoneMap = new Map();
            // BUG-8 FIX: Email parallel of idPhoneMap, used to cross-check
            // `email_sent_addresses` so email campaigns honor the same 7-day window
            // that SMS campaigns already enjoy.
            const idEmailMap = new Map(); // leadId -> normalizedEmail
            const isEmailCampaign = (config?.method === 'email');

            // Filter Setup
            let excludeThreshold = null;
            const isExcludeActive = !!filters.excludeRecentDays && filters.excludeRecentDays !== 'off';
            if (isExcludeActive) {
                // excludeRecentDays can be: 'forever', or a number like 7, 30
                if (filters.excludeRecentDays !== 'forever') {
                    let days = parseInt(filters.excludeRecentDays);
                    if (isNaN(days) || days <= 0) {
                        days = 7; // Default: exclude leads contacted in last 7 days
                        console.log('[BulkSession] excludeRecentDays was not a valid number, defaulting to 7 days');
                    }
                    const date = new Date();
                    date.setDate(date.getDate() - days);
                    // Hardened Timestamp creation
                    const seconds = Math.floor(date.getTime() / 1000);
                    excludeThreshold = new admin.firestore.Timestamp(seconds, 0);
                    console.log(`[BulkSession] Excluding leads contacted within last ${days} days`);
                } else {
                    console.log('[BulkSession] Exclude mode = FOREVER (all previously messaged)');
                }
            }

            let excludedByTimestamp = 0;
            snapshots.forEach(snap => {
                snap.docs.forEach(d => {
                    const data = d.data();
                    let include = true;

                    // Use the most recent timestamp between lastBulkMessageAt and lastContactedAt
                    // lastBulkMessageAt = set by NEW bulk system
                    // lastContactedAt = set by OLD executeReactivationBatch AND individual SMS sends
                    const messageTs = data.lastBulkMessageAt || data.lastContactedAt || null;

                    // In-Memory Filter: Exclude Recent / Forever
                    if (excludeThreshold) {
                        // Time-based: exclude if recently messaged
                        if (messageTs && messageTs >= excludeThreshold) {
                            include = false;
                            excludedByTimestamp++;
                        }
                    } else if (filters.excludeRecentDays === 'forever') {
                        // Forever: exclude if ANY message timestamp exists
                        if (messageTs) {
                            include = false;
                            excludedByTimestamp++;
                        }
                    }

                    // In-Memory Filter: Excluded Leads
                    if (filters.excludedLeadIds && filters.excludedLeadIds.includes(d.id)) {
                        include = false;
                    }
                    if (include) {
                        idSet.add(d.id);
                        // Track phone for secondary sms_sent_phones check
                        const rawPhone = data.phone || data.phoneNumber || '';
                        const { canonical } = derivePhoneLedgerKeys(rawPhone);
                        if (canonical) idPhoneMap.set(d.id, canonical);
                        if (isEmailCampaign) {
                            const normEmail = String(data.email || '').trim().toLowerCase();
                            if (normEmail && normEmail.includes('@')) {
                                idEmailMap.set(d.id, normEmail);
                            }
                        }
                    }
                });
            });
            console.log(`[initBulkSession] Timestamp filter excluded ${excludedByTimestamp} leads (lastBulkMessageAt OR lastContactedAt)`);

            // --- Secondary Phone Filter: Cross-check against sms_sent_phones ---
            // This catches leads that were previously messaged by old campaigns
            // that didn't set lastBulkMessageAt on the lead document.
            if (isExcludeActive && idPhoneMap.size > 0) {
                try {
                    const phoneEntries = Array.from(idPhoneMap.entries()); // [[leadId, canonical], ...]
                    const phoneThresholdTs = buildSmsLedgerThreshold(filters.excludeRecentDays);
                    const recentCanonicals = await findRecentlyMessagedCanonicalPhones({
                        db,
                        companyId,
                        canonicalPhones: phoneEntries.map((e) => e[1]),
                        thresholdTs: phoneThresholdTs,
                    });

                    // Remove leads whose phone was found in sms_sent_phones
                    if (recentCanonicals.size > 0) {
                        let phonesFiltered = 0;
                        for (const [leadId, phone] of phoneEntries) {
                            if (recentCanonicals.has(phone) && idSet.has(leadId)) {
                                idSet.delete(leadId);
                                phonesFiltered++;
                            }
                        }
                        console.log(`[initBulkSession] Phone ledger filter removed ${phonesFiltered} leads (from sms_sent_phones)`);
                    }
                } catch (phoneFilterErr) {
                    // Non-fatal: if phone filter fails, proceed with lastBulkMessageAt-only filtering
                    console.error('[initBulkSession] sms_sent_phones cross-check error (proceeding without):', phoneFilterErr);
                }
            }

            // --- BUG-8: Email ledger cross-check (mirrors SMS ledger) ---
            if (isExcludeActive && isEmailCampaign && idEmailMap.size > 0) {
                try {
                    const emailEntries = Array.from(idEmailMap.entries()); // [[leadId, email], ...]
                    const uniqueEmails = [...new Set(emailEntries.map(e => e[1]))];

                    // Email -> base64 doc id (matches batchWorker encoding)
                    const encode = (e) => Buffer.from(e, 'utf8').toString('base64')
                        .replace(/=+$/, '')
                        .replace(/\//g, '_')
                        .replace(/\+/g, '-');

                    let emailThresholdTs = null;
                    if (filters.excludeRecentDays === 'forever') {
                        emailThresholdTs = null;
                    } else {
                        const days = parseInt(filters.excludeRecentDays) || 7;
                        const thresholdDate = new Date();
                        thresholdDate.setDate(thresholdDate.getDate() - days);
                        emailThresholdTs = admin.firestore.Timestamp.fromDate(thresholdDate);
                    }

                    const recentEmails = new Set();
                    for (let i = 0; i < uniqueEmails.length; i += 10) {
                        const chunk = uniqueEmails.slice(i, i + 10);
                        const docRefs = chunk.map(e =>
                            db.collection('companies').doc(companyId)
                                .collection('email_sent_addresses').doc(encode(e))
                        );
                        const snaps = await db.getAll(...docRefs);
                        snaps.forEach((snap, idx) => {
                            if (!snap.exists) return;
                            const data = snap.data();
                            if (!data.lastSentAt) return;
                            if (emailThresholdTs === null) {
                                recentEmails.add(chunk[idx]);
                            } else if (data.lastSentAt >= emailThresholdTs) {
                                recentEmails.add(chunk[idx]);
                            }
                        });
                    }

                    if (recentEmails.size > 0) {
                        let emailsFiltered = 0;
                        for (const [leadId, email] of emailEntries) {
                            if (recentEmails.has(email) && idSet.has(leadId)) {
                                idSet.delete(leadId);
                                emailsFiltered++;
                            }
                        }
                        console.log(`[initBulkSession] Email ledger filter removed ${emailsFiltered} leads (from email_sent_addresses)`);
                    }
                } catch (emailFilterErr) {
                    console.error('[initBulkSession] email_sent_addresses cross-check error (proceeding without):', emailFilterErr);
                }
            }

            finalTargetIds = Array.from(idSet);
        } catch (qErr) {
            throw new HttpsError('internal', `Query execution failed: ${qErr.message}`);
        }
    return finalTargetIds;
};

module.exports = {
    verifyDirectSelection,
    gatherIdsFromQueries,
};
