const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");
const { assertCompanyAdmin } = require("../helpers/auth");
const { buildLeadQueries } = require("../helpers/queryBuilder");
const { enqueueWorker } = require("../services/queueService");
const { checkRateLimit } = require("../../shared/rateLimiter");
const {
    derivePhoneLedgerKeys,
    buildSmsLedgerThreshold,
    findRecentlyMessagedCanonicalPhones,
} = require("../helpers/phoneLedger");

/**
 * 1. Initialize Bulk Session
 */
exports.initBulkSession = onCall({
    cors: true,
    timeoutSeconds: 540,
    secrets: ['BULK_WORKER_SECRET', 'PROCESS_BULK_BATCH_URL'],
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated');

    const { companyId, filters, config, sessionName, targetIds } = request.data;
    if (!companyId || !config || !config.message) {
        throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    // RBAC
    await assertCompanyAdmin(request.auth.uid, companyId);

    // BULK-5 FIX: Rate limit bulk session creation to prevent runaway SMS spend.
    // Maximum 10 bulk sessions per company per hour. A session may still contain thousands
    // of recipients, so this prevents accidental double-submits, not intentional high volume.
    const isAllowed = await checkRateLimit(`bulk_init_${companyId}`, 10, 3600, 'closed');
    if (!isAllowed) {
        throw new HttpsError('resource-exhausted', 'Too many bulk sessions created recently. Please wait before starting another.');
    }

    const leadSourceType = filters.leadType || 'applications'; // 'global', 'leads', 'applications' (default)

    // A. ID Gathering Phase
    let finalTargetIds = [];
    if (targetIds && Array.isArray(targetIds) && targetIds.length > 0) {
        // Direct Selection (e.g. from table selection)
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

    } else if (leadSourceType === 'import' && request.data.rawData && Array.isArray(request.data.rawData)) {
        // C. Import: Raw Data Handling
        // We defer ID generation until after session creation used to guarantee unique IDs
        // or we generate them later. For now, we leave finalTargetIds empty and rely on the check below.
        finalTargetIds = [];

    } else {
        // Query Based
        const queries = buildLeadQueries(companyId, filters, request.auth.uid);
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
        // AUDIT FIX #4: Worker generation counter for zombie prevention
        workerGeneration: 1,
        // BUG-4 FIX: Removed redundant 'stats' field — only 'progress' is updated by the worker.
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
        await enqueueWorker(companyId, sessionId, 1, 1); // workerGeneration = 1
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

    // AUDIT FIX #4: Increment workerGeneration on resume to invalidate stale workers
    const updatePayload = {
        status: status,
        updatedBy: request.auth.uid,
        lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (status === 'active') {
        updatePayload.workerGeneration = admin.firestore.FieldValue.increment(1);
    }
    await sessionRef.update(updatePayload);

    // If resuming, kick off worker again.
    // P2 HARDENING: Defensive reads — older/failed sessions may be missing
    // `progress` or `targetIds`. Crashing here means a recruiter clicks Resume
    // and sees an opaque INTERNAL error with no recovery path.
    if (status === 'active') {
        const snap = await sessionRef.get();
        if (!snap.exists) {
            throw new HttpsError('not-found', 'Session not found.');
        }
        const sessionData = snap.data() || {};
        const pointer = sessionData.progress?.currentPointer ?? 0;
        const total = Array.isArray(sessionData.targetIds) ? sessionData.targetIds.length : 0;
        if (total === 0) {
            // Already-empty target list — mark as completed instead of busy-looping a worker.
            await sessionRef.update({
                status: 'completed',
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return { success: true, message: 'No remaining targets — session marked complete.' };
        }
        if (pointer < total) {
            await enqueueWorker(companyId, sessionId, 1, sessionData.workerGeneration);
        }
    }
    return { success: true };
};

exports.pauseBulkSession = onCall({ cors: true }, (req) => updateSessionStatus(req, 'paused'));
exports.resumeBulkSession = onCall(
    { cors: true, secrets: ['BULK_WORKER_SECRET', 'PROCESS_BULK_BATCH_URL'] },
    (req) => updateSessionStatus(req, 'active'),
);
exports.cancelBulkSession = onCall({ cors: true }, (req) => updateSessionStatus(req, 'cancelled'));


/**
 * 3. Retry Failed
 */
exports.retryFailedAttempts = onCall(
    { cors: true, secrets: ['BULK_WORKER_SECRET', 'PROCESS_BULK_BATCH_URL'] },
    async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated');
    // BUG-1 FIX: Frontend sends 'originalSessionId' but backend expected 'sessionId'.
    // Accept both for backward compatibility.
    const { companyId, sessionId: directId, originalSessionId } = request.data;
    const sessionId = directId || originalSessionId;
    if (!sessionId) throw new HttpsError('invalid-argument', 'Session ID is required.');
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

    // BUG-11 FIX: Remove heavy/non-transfer fields before spreading so we don't
    // duplicate the original full targetIds array in the retry session document.
    const sessionConfig = { ...data };
    delete sessionConfig.targetIds;
    delete sessionConfig.id;
    delete sessionConfig.progress;

    await newSessionRef.set({
        ...sessionConfig, // Copy config/filters without the heavy fields
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
        retryCount: (data.retryCount || 0) + 1,
        // AUDIT FIX #3: For import-type retries, store the original session ID
        // so the worker knows where to find target docs in the 'targets' subcollection.
        importSourceSessionId: data.importSourceSessionId || sessionId,
        // AUDIT FIX #4: Reset worker generation for new session
        workerGeneration: 1
    });

    await enqueueWorker(companyId, newSessionId, 1, 1); // workerGeneration = 1

    return { success: true, newSessionId };
});
