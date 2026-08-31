// =====================================================================
// Persisting an import's targets and filtering out recently-messaged ones.
//
// `initBulkSession`'s import-persistence phase, extracted verbatim from
// `sessionController.js`. Raw import rows are written to the session's
// `targets` subcollection in batches, each row minting the import ID that
// becomes its target ID, and then the recently-messaged exclusions run over
// what was just written: the sms_sent_phones ledger and, for email
// campaigns, the email_sent_addresses ledger. Filtered rows are removed
// from the target list and their target docs cleaned up.
// =====================================================================

const { admin, db } = require("../../../firebaseAdmin");
const {
    derivePhoneLedgerKeys,
    findRecentlyMessagedCanonicalPhones,
} = require("../../helpers/phoneLedger");

/**
 * Persists raw import rows as session targets and applies the
 * recently-messaged filters. Returns the updated target-ID list and how many
 * rows the filters removed.
 */
const persistImportTargets = async ({ companyId, sessionRef, rawItems, filters, config, finalTargetIds }) => {
    let importFilteredCount = 0;
        const excludeRecentImport = filters.excludeRecentDays && filters.excludeRecentDays !== 'off';
        const excludeForever = filters.excludeRecentDays === 'forever';
        const batchArray = [];
        let batch = db.batch();
        let count = 0;

        // Build phone-to-importId mapping for 7-day filter
        const phoneToIdMap = new Map(); // canonical phone -> Set(importId)
        const emailToIdMap = new Map(); // normalizedEmail -> importId (BUG-8)
        const isEmailCampaignImport = (config?.method === 'email');

        for (let i = 0; i < rawItems.length; i++) {
            const item = rawItems[i];
            const importId = `imp_${i}_${Date.now()}`; // Simple unique ID within session context
            finalTargetIds.push(importId);

            // Track phone mapping for dedup filter
            const { canonical } = derivePhoneLedgerKeys(item.phone || item.phoneNumber || '');
            if (canonical) {
                if (!phoneToIdMap.has(canonical)) phoneToIdMap.set(canonical, new Set());
                phoneToIdMap.get(canonical).add(importId);
            }
            if (isEmailCampaignImport) {
                const normEmail = String(item.email || '').trim().toLowerCase();
                if (normEmail && normEmail.includes('@')) {
                    emailToIdMap.set(normEmail, importId);
                }
            }

            const targetRef = sessionRef.collection('targets').doc(importId);
            batch.set(targetRef, {
                ...item,
                importedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            count++;

            if (count >= 490) { // Safety margin < 500
                batchArray.push(batch);
                batch = db.batch();
                count = 0;
            }
        }
        if (count > 0) batchArray.push(batch);

        // Execute all batches
        await Promise.all(batchArray.map(b => b.commit()));

        // --- 7-Day Phone Filter for Imports ---
        if (excludeRecentImport && phoneToIdMap.size > 0) {
            try {
                // Calculate threshold (7 days ago)
                const thresholdDate = new Date();
                if (!excludeForever) {
                    const days = parseInt(filters.excludeRecentDays) || 7;
                    thresholdDate.setDate(thresholdDate.getDate() - days);
                } else {
                    // For 'forever', set threshold to epoch (include all records)
                    thresholdDate.setTime(0);
                }
                const thresholdTs = admin.firestore.Timestamp.fromDate(thresholdDate);

                const canonicalPhones = Array.from(phoneToIdMap.keys());
                const recentPhones = await findRecentlyMessagedCanonicalPhones({
                    db,
                    companyId,
                    canonicalPhones,
                    thresholdTs,
                });

                // Remove recently-messaged contacts from finalTargetIds
                if (recentPhones.size > 0) {
                    const idsToRemove = new Set();
                    recentPhones.forEach((phone) => {
                        const importIds = phoneToIdMap.get(phone);
                        if (!importIds) return;
                        importIds.forEach((importId) => idsToRemove.add(importId));
                    });

                    // Filter out the IDs
                    finalTargetIds = finalTargetIds.filter(id => !idsToRemove.has(id));
                    importFilteredCount = idsToRemove.size;

                    // Clean up target docs for filtered items (fire-and-forget)
                    const cleanupBatch = db.batch();
                    let cleanupCount = 0;
                    idsToRemove.forEach(id => {
                        cleanupBatch.delete(sessionRef.collection('targets').doc(id));
                        cleanupCount++;
                    });
                    if (cleanupCount > 0) {
                        cleanupBatch.commit().catch(e =>
                            console.error('Failed to cleanup filtered target docs:', e)
                        );
                    }

                    console.log(`[initBulkSession] 7-day filter removed ${importFilteredCount} recently-messaged phones from import`);
                }
            } catch (filterErr) {
                // Non-fatal: if filter fails, proceed with all contacts
                console.error('[initBulkSession] 7-day phone filter error (proceeding without filter):', filterErr);
            }
        }

        // --- BUG-8: 7-Day Email Filter for Imports (parallels phone path) ---
        if (excludeRecentImport && isEmailCampaignImport && emailToIdMap.size > 0) {
            try {
                const thresholdDate = new Date();
                if (!excludeForever) {
                    const days = parseInt(filters.excludeRecentDays) || 7;
                    thresholdDate.setDate(thresholdDate.getDate() - days);
                } else {
                    thresholdDate.setTime(0);
                }
                const thresholdTs = admin.firestore.Timestamp.fromDate(thresholdDate);

                const emails = Array.from(emailToIdMap.keys());
                const encode = (e) => Buffer.from(e, 'utf8').toString('base64')
                    .replace(/=+$/, '')
                    .replace(/\//g, '_')
                    .replace(/\+/g, '-');
                const recentEmails = new Set();

                for (let i = 0; i < emails.length; i += 10) {
                    const chunk = emails.slice(i, i + 10);
                    const docRefs = chunk.map(e =>
                        db.collection('companies').doc(companyId)
                            .collection('email_sent_addresses').doc(encode(e))
                    );
                    const snapshots = await db.getAll(...docRefs);
                    snapshots.forEach((snap, idx) => {
                        if (!snap.exists) return;
                        const data = snap.data();
                        if (data.lastSentAt && data.lastSentAt >= thresholdTs) {
                            recentEmails.add(chunk[idx]);
                        }
                    });
                }

                if (recentEmails.size > 0) {
                    const idsToRemove = new Set();
                    recentEmails.forEach(email => {
                        const importId = emailToIdMap.get(email);
                        if (importId) idsToRemove.add(importId);
                    });
                    finalTargetIds = finalTargetIds.filter(id => !idsToRemove.has(id));
                    importFilteredCount += idsToRemove.size;

                    const cleanupBatch = db.batch();
                    let cleanupCount = 0;
                    idsToRemove.forEach(id => {
                        cleanupBatch.delete(sessionRef.collection('targets').doc(id));
                        cleanupCount++;
                    });
                    if (cleanupCount > 0) {
                        cleanupBatch.commit().catch(e =>
                            console.error('Failed to cleanup email-filtered target docs:', e)
                        );
                    }
                    console.log(`[initBulkSession] 7-day filter removed ${idsToRemove.size} recently-messaged emails from import`);
                }
            } catch (emailFilterErr) {
                console.error('[initBulkSession] 7-day email filter error (proceeding without filter):', emailFilterErr);
            }
        }
    return { finalTargetIds, importFilteredCount };
};

module.exports = {
    persistImportTargets,
};
