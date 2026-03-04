const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");
const { assertCompanyAdmin } = require("../helpers/auth");
const { buildLeadQueries } = require("../helpers/queryBuilder");
const { enqueueWorker } = require("../services/queueService");
const { normalizePhone } = require("../../utils/phoneUtils");

/**
 * 1. Initialize Bulk Session
 */
exports.initBulkSession = onCall({ cors: true, timeoutSeconds: 540 }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated');

    const { companyId, filters, config, sessionName, targetIds } = request.data;
    if (!companyId || !config || !config.message) {
        throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    // RBAC
    await assertCompanyAdmin(request.auth.uid, companyId);

    const leadSourceType = filters.leadType || 'applications'; // 'global', 'leads', 'applications' (default)

    // A. ID Gathering Phase
    let finalTargetIds = [];
    if (targetIds && Array.isArray(targetIds) && targetIds.length > 0) {
        // Direct Selection (e.g. from table selection)
        finalTargetIds = targetIds;

    } else if (leadSourceType === 'import' && request.data.rawData && Array.isArray(request.data.rawData)) {
        // C. Import: Raw Data Handling
        // We defer ID generation until after session creation used to guarantee unique IDs
        // or we generate them later. For now, we leave finalTargetIds empty and rely on the check below.
        finalTargetIds = [];

    } else {
        // Query Based
        console.log("DEBUG: Building queries with filters:", JSON.stringify(filters));
        const queries = buildLeadQueries(companyId, filters, request.auth.uid);
        console.log(`DEBUG: Generated ${queries.length} queries.`);

        // Apply .select() to only fetch fields needed for in-memory filtering.
        // This prevents crashes from corrupt Timestamp fields in documents.
        const fieldsNeeded = ['lastBulkMessageAt', 'lastContactedAt', 'phone', 'phoneNumber'];
        const selectQueries = queries.map(q => q.select(...fieldsNeeded));

        // Execute all queries to get IDs
        try {
            // Execute sequentially to identify which one fails
            const snapshots = [];
            for (let i = 0; i < selectQueries.length; i++) {
                try {
                    console.log(`DEBUG: Executing query #${i}...`);
                    const snap = await selectQueries[i].get();
                    snapshots.push(snap);
                    console.log(`DEBUG: Query #${i} returned ${snap.size} docs.`);
                } catch (innerErr) {
                    console.error(`DEBUG: Query #${i} failed:`, innerErr.message);
                    throw innerErr;
                }
            }

            const idSet = new Set();
            // Map: leadId -> normalizedPhone (for secondary sms_sent_phones check)
            const idPhoneMap = new Map();

            // Filter Setup
            let excludeThreshold = null;
            const isExcludeActive = !!filters.excludeRecentDays && filters.excludeRecentDays !== 'off';
            if (isExcludeActive) {
                // excludeRecentDays can be: 'forever', or a number like 7, 30
                if (filters.excludeRecentDays !== 'forever') {
                    let days = parseInt(filters.excludeRecentDays);
                    if (isNaN(days) || days <= 0) {
                        days = 7; // Default: exclude leads contacted in last 7 days
                        console.log("DEBUG: excludeRecentDays was not a number, defaulting to 7 days");
                    }
                    const date = new Date();
                    date.setDate(date.getDate() - days);
                    // Hardened Timestamp creation
                    const seconds = Math.floor(date.getTime() / 1000);
                    excludeThreshold = new admin.firestore.Timestamp(seconds, 0);
                    console.log(`DEBUG: Exclude Threshold: ${excludeThreshold.toDate().toISOString()} (days=${days})`);
                } else {
                    console.log("DEBUG: Exclude mode = FOREVER (all previously messaged)");
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
                        const normPhone = normalizePhone(rawPhone);
                        if (normPhone && normPhone.length >= 10 && normPhone.length <= 11) {
                            idPhoneMap.set(d.id, normPhone);
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
                    const phoneEntries = Array.from(idPhoneMap.entries()); // [[leadId, phone], ...]
                    const phonesToCheck = [...new Set(phoneEntries.map(e => e[1]))]; // unique phones
                    const recentPhones = new Set();

                    // Calculate threshold for sms_sent_phones check
                    let phoneThresholdTs = null;
                    if (filters.excludeRecentDays === 'forever') {
                        phoneThresholdTs = null; // null means exclude all
                    } else {
                        const days = parseInt(filters.excludeRecentDays) || 7;
                        const thresholdDate = new Date();
                        thresholdDate.setDate(thresholdDate.getDate() - days);
                        phoneThresholdTs = admin.firestore.Timestamp.fromDate(thresholdDate);
                    }

                    // Query sms_sent_phones in batches of 10 (Firestore getAll limit)
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
                                // 'forever': exclude any phone that exists
                                recentPhones.add(snap.id);
                            } else if (data.lastSentAt >= phoneThresholdTs) {
                                // Time-based: exclude if sent within the threshold
                                recentPhones.add(snap.id);
                            }
                        });
                    }

                    // Remove leads whose phone was found in sms_sent_phones
                    if (recentPhones.size > 0) {
                        let phonesFiltered = 0;
                        for (const [leadId, phone] of phoneEntries) {
                            if (recentPhones.has(phone) && idSet.has(leadId)) {
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

            finalTargetIds = Array.from(idSet);
        } catch (qErr) {
            throw new HttpsError('internal', `Query execution failed: ${qErr.message}`);
        }
    }


    if (finalTargetIds.length === 0 && (!request.data.rawData || leadSourceType !== 'import')) {
        // Only return error if NOT import (since import logic handles IDs below)
        return { success: false, message: "No leads found matching criteria." };
    }

    // B. Create Session Doc
    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc();
    const sessionId = sessionRef.id;

    // Handle Import Persistence NOW if applicable
    let importFilteredCount = 0;
    if (leadSourceType === 'import' && request.data.rawData) {
        const rawItems = request.data.rawData;
        const excludeRecentImport = filters.excludeRecentDays && filters.excludeRecentDays !== 'off';
        const excludeForever = filters.excludeRecentDays === 'forever';
        const batchArray = [];
        let batch = db.batch();
        let count = 0;

        // Build phone-to-importId mapping for 7-day filter
        const phoneToIdMap = new Map(); // normalizedPhone -> importId

        for (let i = 0; i < rawItems.length; i++) {
            const item = rawItems[i];
            const importId = `imp_${i}_${Date.now()}`; // Simple unique ID within session context
            finalTargetIds.push(importId);

            // Track phone mapping for dedup filter
            const normPhone = normalizePhone(item.phone || item.phoneNumber || '');
            if (normPhone) {
                phoneToIdMap.set(normPhone, importId);
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

                // Query sms_sent_phones in batches of 10 (Firestore 'in' query limit)
                const phoneNumbers = Array.from(phoneToIdMap.keys());
                const recentPhones = new Set();

                for (let i = 0; i < phoneNumbers.length; i += 10) {
                    const chunk = phoneNumbers.slice(i, i + 10);
                    // Get docs by ID (phone numbers are doc IDs)
                    const docRefs = chunk.map(p =>
                        db.collection('companies').doc(companyId)
                            .collection('sms_sent_phones').doc(p)
                    );
                    const snapshots = await db.getAll(...docRefs);

                    snapshots.forEach(snap => {
                        if (snap.exists) {
                            const data = snap.data();
                            if (data.lastSentAt && data.lastSentAt >= thresholdTs) {
                                recentPhones.add(snap.id);
                            }
                        }
                    });
                }

                // Remove recently-messaged contacts from finalTargetIds
                if (recentPhones.size > 0) {
                    const idsToRemove = new Set();
                    recentPhones.forEach(phone => {
                        const importId = phoneToIdMap.get(phone);
                        if (importId) {
                            idsToRemove.add(importId);
                        }
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
    }

    // Validate count again after import processing
    if (finalTargetIds.length === 0) {
        return { success: false, message: "No leads found matching criteria (or empty import)." };
    }


    // Persist targets to subcollection if too large for single doc array (Map limit 1MB)
    // 50k IDs * 20 chars = 1MB. So > 10k is risky.
    // Strategy: Store in doc if < 5000, else use batches?
    // For now, consistent strategy: store in `targets` subcollection if 'import', or just array if reasonable?
    // Actually, `bulkActions_OLD.js` stored them in `targetIds` array on doc.
    // If list is huge (e.g. 50k), this fails Firestore limit.
    // FIX: We will store IDs in chunks in a subcollection 'partitions' or just rely on 'targetIds' for now (assuming < 10k use cases).
    // If > 10k, we should throw or handle.
    if (finalTargetIds.length > 10000) {
        throw new HttpsError('invalid-argument', 'Too many leads selected. Please narrow filters (< 10,000).');
    }

    // Optimization: Store leadSourceType on session
    await sessionRef.set({
        id: sessionId,
        name: sessionName || `Bulk Action ${new Date().toLocaleDateString()}`,
        status: 'pending', // pending -> active
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: request.auth.uid,
        updatedBy: request.auth.uid,
        config: config, // { method: 'sms'|'email', message: '...', ... }
        filters: filters,
        leadSourceType: leadSourceType,
        targetIds: finalTargetIds, // Array of strings
        stats: {
            total: finalTargetIds.length,
            processed: 0,
            success: 0,
            failed: 0
        },
        progress: {
            currentPointer: 0, // Index in targetIds
            totalCount: finalTargetIds.length,
            processedCount: 0,
            successCount: 0,
            failedCount: 0
        },
        lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // C. Import Targets (Optional - if we need specific data snapshot)
    // If 'import' type, we assume targetIds came with data?
    // For now, we rely on fetching current data during worker execution.

    // D. Start Worker (Async)
    await sessionRef.update({ status: 'active' });

    // Kick off the first batch (Delay 1s)
    try {
        await enqueueWorker(companyId, sessionId, 1);
    } catch (e) {
        // If queue fails, mark session failed
        await sessionRef.update({ status: 'failed', error: 'Failed to start queue.' });
        throw e;
    }

    return { success: true, sessionId: sessionId, targetCount: finalTargetIds.length, filteredCount: importFilteredCount };
});


/**
 * 2. Control Actions (Pause, Resume, Cancel)
 */
const updateSessionStatus = async (request, status) => {
    if (!request.auth) throw new HttpsError('unauthenticated');
    const { companyId, sessionId } = request.data;
    await assertCompanyAdmin(request.auth.uid, companyId);

    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);
    await sessionRef.update({
        status: status,
        updatedBy: request.auth.uid,
        lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // If resuming, kick off worker again
    if (status === 'active') {
        const snap = await sessionRef.get();
        // Check if completed
        if (snap.data().progress.currentPointer < snap.data().targetIds.length) {
            await enqueueWorker(companyId, sessionId, 1);
        }
    }
    return { success: true };
};

exports.pauseBulkSession = onCall({ cors: true }, (req) => updateSessionStatus(req, 'paused'));
exports.resumeBulkSession = onCall({ cors: true }, (req) => updateSessionStatus(req, 'active'));
exports.cancelBulkSession = onCall({ cors: true }, (req) => updateSessionStatus(req, 'cancelled'));


/**
 * 3. Retry Failed
 */
exports.retryFailedAttempts = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated');
    const { companyId, sessionId } = request.data;
    await assertCompanyAdmin(request.auth.uid, companyId);

    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);
    const snap = await sessionRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Session not found');

    const data = snap.data();

    // Identify failed IDs
    // We can query the 'logs' subcollection for status: 'failed'
    const logsSnap = await sessionRef.collection('logs').where('status', '==', 'failed').get();
    const failedIds = logsSnap.docs.map(d => d.id);

    if (failedIds.length === 0) return { success: true, message: "No failed items to retry." };

    // Create NEW session for retry
    const newSessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc();
    const newSessionId = newSessionRef.id;

    await newSessionRef.set({
        ...data, // Copy config/filters
        id: newSessionId,
        name: `${data.name} (Retry)`,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        targetIds: failedIds,
        progress: {
            currentPointer: 0,
            totalCount: failedIds.length,
            processedCount: 0,
            successCount: 0,
            failedCount: 0
        },
        retryOf: sessionId,
        retryCount: (data.retryCount || 0) + 1
    });

    await enqueueWorker(companyId, newSessionId, 1);

    return { success: true, newSessionId };
});
