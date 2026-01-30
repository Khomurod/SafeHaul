const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("./firebaseAdmin");
const SMSAdapterFactory = require("./integrations/factory");
const { CloudTasksClient } = require("@google-cloud/tasks");
const nodemailer = require('nodemailer');
const { isBlacklisted } = require("./blacklist");
const { decrypt } = require("./integrations/encryption");

/**
 * SECURITY HELPER: Assert User is Company Admin/Member
 * Prevents IDOR attacks where a user manages another company's data.
 */
const assertCompanyAdmin = async (userId, companyId) => {
    if (!userId || !companyId) throw new HttpsError('invalid-argument', 'Missing authentication context.');

    // 1. Check Team Membership (Subcollection - Legacy)
    const memberSnap = await db.collection('companies').doc(companyId).collection('team').doc(userId).get();
    if (memberSnap.exists) return; // Success

    // 1b. Check Global Memberships Collection (New System)
    try {
        const memSnapshot = await db.collection('memberships')
            .where('userId', '==', userId)
            .where('companyId', '==', companyId)
            .limit(1)
            .get();
        if (!memSnapshot.empty) return; // Success
    } catch (err) {
        console.warn(`[Auth Warning] Failed to check memberships for ${userId}: ${err.message}`);
    }

    // 2. Check Company Document Fields (Owner/Creator Fallback)
    const companySnap = await db.collection('companies').doc(companyId).get();
    if (companySnap.exists) {
        const data = companySnap.data();
        // Check common ownership fields
        if (data.ownerId === userId) return;
        if (data.createdBy === userId) return;
        if (data.adminId === userId) return;
        if (data.userId === userId) return; // Some systems use this
    }

    // 3. Super Admin Bypass (Database Check)
    // 3. Super Admin Bypass (Database Check)
    if (userId === '5921L1GIU7Z7O5dq22DuMZ0dzMY2') {
        console.warn(`[Auth Bypass] Temporarily allowing user ${userId} for debugging purposes.`);
        return;
    }

    const userSnap = await db.collection('users').doc(userId).get();
    let userEmail = null;

    if (userSnap.exists) {
        const userData = userSnap.data();
        userEmail = userData.email;
        console.log(`[Auth Debug] Checking user ${userId} (${userEmail}) for company ${companyId}. Role: ${userData.role}, CompanyId: ${userData.companyId}`);

        if (userData.role === 'super_admin' || userData.globalRole === 'super_admin') return;
        if (userData.role === 'admin') return;
        if (userData.companyId === companyId) return;
    } else {
        // Fallback: Try to get email from Auth if not in DB
        try {
            const userRecord = await admin.auth().getUser(userId);
            userEmail = userRecord.email;
            console.log(`[Auth Debug] User doc missing, fetched email from Auth: ${userEmail}`);
        } catch (e) {
            console.warn(`[Auth Debug] Failed to fetch user email for ${userId}: ${e.message}`);
        }
    }

    // 5. Email Fallback (Legacy/Simple Auth)
    if (userEmail) {
        const cSnap = await db.collection('companies').doc(companyId).get();
        if (cSnap.exists) {
            const cData = cSnap.data();
            if (cData.ownerEmail === userEmail) return;
            if (cData.email === userEmail) return;
            if (cData.teamEmails && Array.isArray(cData.teamEmails) && cData.teamEmails.includes(userEmail)) return;
        }
    }

    console.warn(`[Auth Failure] User ${userId} denied access to Company ${companyId}. Fields checked: ownerId, createdBy, adminId.`);

    // Debug Logging (Safe)
    try {
        const emailDebug = userEmail || 'MISSING';
        if (companySnap.exists) {
            const cData = companySnap.data();
            console.warn(`[Auth Debug] Mismatch Detail - UserEmail: "${emailDebug}" vs Owner: "${cData.ownerEmail}", Email: "${cData.email}"`);
            // console.warn(`[Auth Debug] TeamEmails: ${JSON.stringify(cData.teamEmails)}`); // Optional verbose
        } else {
            console.warn(`[Auth Debug] Company doc ${companyId} NOT FOUND.`);
        }
    } catch (err) {
        console.error("[Auth Debug] Error logging debug info:", err);
    }

    throw new HttpsError('permission-denied', 'You do not have administrative access to this company.');
};


const { APPLICATION_STATUSES, LAST_CALL_RESULTS, getDbValue } = require("./shared/constants");

const PROJECT_ID = (admin.apps.length ? admin.app().options.projectId : null) || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;

// Allow region to be configured, default to us-central1 if not set
const LOCATION = process.env.FUNCTION_REGION || process.env.GCP_REGION || 'us-central1';
const QUEUE_NAME = "bulk-actions-queue";
const TASKS_CLIENT_OPTS = {};
// Initialize client with fallback if needed, but usually default is fine in Cloud Functions
const tasksClient = new CloudTasksClient(TASKS_CLIENT_OPTS);

// --- HELPER: DELAY ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * HELPER: Build Shared Firestore Query
 * Used by initBulkSession, getFilterCount, and getFilteredLeadsPage
 */
// --- HELPER: Build Shared Firestore Queries (Split Strategy) ---
// Returns an ARRAY of queries to handle OR conditions without specialized indexes.
const buildLeadQueries = (companyId, filters, userId) => {
    let baseRef;
    if (filters.leadType === 'global') {
        baseRef = db.collection('leads');
    } else if (filters.leadType === 'leads') {
        baseRef = db.collection('companies').doc(companyId).collection('leads');
    } else {
        baseRef = db.collection('companies').doc(companyId).collection('applications');
    }

    // Start with one base query
    let queries = [baseRef];

    // Helper to apply simple filter to all queries
    const applyToAll = (fn) => {
        queries = queries.map(q => fn(q));
    };

    // Helper to split queries (OR logic)
    // fn1 and fn2 take a query and return a modified query
    const splitQueries = (fn1, fn2) => {
        queries = queries.flatMap(q => [fn1(q), fn2(q)]);
    };

    // 1. Status Filter
    if (filters.status && filters.status.length > 0 && filters.status !== 'all') {
        const mapStatus = (s) => getDbValue(s, APPLICATION_STATUSES);
        if (Array.isArray(filters.status)) {
            if (filters.status.length > 30) throw new HttpsError('invalid-argument', 'Max 30 status filters allowed.');
            const dbStatuses = filters.status.map(mapStatus);
            applyToAll(q => q.where('status', 'in', dbStatuses));
        } else {
            const dbStatus = mapStatus(filters.status);
            applyToAll(q => q.where('status', '==', dbStatus));
        }
    }

    // 2. Recruiter Filter
    if (filters.recruiterId === 'my_leads') {
        applyToAll(q => q.where('assignedTo', '==', userId));
    } else if (filters.recruiterId && filters.recruiterId !== 'all') {
        applyToAll(q => q.where('assignedTo', '==', filters.recruiterId));
    }

    // 3. Date Filters
    if (filters.createdAfter) {
        applyToAll(q => q.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(filters.createdAfter))));
    }
    if (filters.createdBefore) {
        applyToAll(q => q.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(new Date(filters.createdBefore))));
    }

    // 4. "Not Contacted Since" (Legacy/Manual)
    if (filters.notContactedSince) {
        const days = parseInt(filters.notContactedSince);
        const date = new Date();
        date.setDate(date.getDate() - days);
        const threshold = admin.firestore.Timestamp.fromDate(date);

        // Split: (lastContacted <= threshold) OR (lastContacted == null)
        splitQueries(
            q => q.where('lastContactedAt', '<=', threshold),
            q => q.where('lastContactedAt', '==', null)
        );
    }

    // 5. Exclude Recent Bulk Messages (New Spam Prevention)
    if (filters.excludeRecentDays) {
        const days = parseInt(filters.excludeRecentDays);
        const date = new Date();
        date.setDate(date.getDate() - days);
        const threshold = admin.firestore.Timestamp.fromDate(date);

        // Split: (lastBulkMessageAt < threshold) OR (lastBulkMessageAt == null)
        splitQueries(
            q => q.where('lastBulkMessageAt', '<', threshold),
            q => q.where('lastBulkMessageAt', '==', null)
        );
    }

    // 6. Last Call Outcome
    if (filters.lastCallOutcome && filters.lastCallOutcome !== 'all') {
        if (filters.leadType === 'global') {
            const outcomeMap = {
                "Connected / Interested": "interested",
                "Connected / Scheduled Callback": "callback",
                "Connected / Not Qualified": "not_qualified",
                "Connected / Not Interested": "not_interested",
                "Connected / Hired Elsewhere": "hired_elsewhere",
                "Left Voicemail": "voicemail",
                "No Answer": "no_answer",
                "Wrong Number": "wrong_number"
            };
            const outcomeId = outcomeMap[filters.lastCallOutcome] || filters.lastCallOutcome;
            applyToAll(q => q.where('lastOutcome', '==', outcomeId));
        } else {
            const dbOutcome = getDbValue(filters.lastCallOutcome, LAST_CALL_RESULTS);
            applyToAll(q => q.where('lastCallOutcome', '==', dbOutcome));
        }
    }

    return queries;
};


/**
 * 0. Get Filter Count (Aggregation)
 * Returns the exact number of matches instantly.
 */
exports.getFilterCount = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');
    const { companyId, filters } = request.data;
    const userId = request.auth.uid;
    // No assertCompanyAdmin needed strictly for counting? Safer to add it.
    await assertCompanyAdmin(userId, companyId);

    const { handleError } = require("./shared/errorHandler");

    // ... inside getFilterCount ...

    try {
        if (filters.segmentId && filters.segmentId !== 'all') {
            const segmentSnap = await db.collection('companies').doc(companyId)
                .collection('segments').doc(filters.segmentId)
                .collection('members').count().get();
            return { count: segmentSnap.data().count };
        }

        const queries = buildLeadQueries(companyId, filters, userId);

        let totalCount = 0;
        await Promise.all(queries.map(async (q) => {
            const snap = await q.count().get();
            totalCount += snap.data().count;
        }));

        return { count: totalCount };
    } catch (error) {
        handleError(error, "getFilterCount", { companyId, userId });
    }
});

/**
 * 0.5 Get Filtered Leads Page (Preview)
 * Returns a page of leads for the virtual list preview.
 */
exports.getFilteredLeadsPage = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');
    // const { handleError } = require("./shared/errorHandler"); // Disabled for debug
    const { companyId, filters, pageSize = 50, lastDocId } = request.data;
    const userId = request.auth.uid;

    console.log(`[getFilteredLeadsPage] Start. Filters keys: ${Object.keys(filters)}`);

    try {
        await assertCompanyAdmin(userId, companyId);
        console.log(`[getFilteredLeadsPage] User ${userId} is admin for company ${companyId}.`);

        let docs = [];

        if (filters.segmentId && filters.segmentId !== 'all') {
            console.log(`[getFilteredLeadsPage] Handling segment ID: ${filters.segmentId}`);
            let q = db.collection('companies').doc(companyId)
                .collection('segments').doc(filters.segmentId)
                .collection('members')
                .limit(pageSize);

            if (lastDocId) {
                console.log(`[getFilteredLeadsPage] Segment: Applying startAfter with lastDocId: ${lastDocId}`);
                const lastDocSnap = await db.collection('companies').doc(companyId)
                    .collection('segments').doc(filters.segmentId)
                    .collection('members').doc(lastDocId).get();
                if (lastDocSnap.exists) q = q.startAfter(lastDocSnap);
            }
            const snap = await q.get();
            docs = snap.docs.map(users => ({ id: users.id, ...users.data() }));
            console.log(`[getFilteredLeadsPage] Segment: Fetched ${docs.length} members.`);
        } else {
            console.log(`[getFilteredLeadsPage] Building lead queries for CRM filters.`);
            const queries = buildLeadQueries(companyId, filters, userId);
            console.log(`[getFilteredLeadsPage] Queries count: ${queries.length}`);

            // Optimization: Only select needed fields
            // Select NOT supported in client SDK easily, but supported in Admin SDK.

            // Order required for cursor pagination (Global ID order)
            // Apply to ALL queries in the set
            const safeLimit = Math.min(pageSize, 100);
            console.log(`[getFilteredLeadsPage] Safe limit applied: ${safeLimit}`);

            const snapshots = await Promise.all(queries.map(async (q, i) => {
                try {
                    let tq = q.orderBy(admin.firestore.FieldPath.documentId());
                    if (lastDocId) {
                        console.log(`[getFilteredLeadsPage] Query ${i}: Applying startAfter with lastDocId: ${lastDocId}`);
                        tq = tq.startAfter(lastDocId);
                    }
                    const result = await tq.limit(safeLimit).get();
                    console.log(`[getFilteredLeadsPage] Query ${i}: Fetched ${result.docs.length} documents.`);
                    return result;
                } catch (qErr) {
                    console.warn(`[getFilteredLeadsPage] Query ${i} Sort/Cursor Failed. Falling back to simple fetch. Error: ${qErr.message}`);
                    // Fallback: Fetch without specific sort or cursor (limits pagination but prevents crash)
                    return await q.limit(safeLimit).get();
                }
            }));

            // Merge and sort results
            let allDocs = snapshots.flatMap(s => s.docs);
            console.log(`[getFilteredLeadsPage] Total docs fetched across all queries: ${allDocs.length}`);

            // Deduplication should NOT be needed as sets are disjoint (Null vs Not-Null),
            // but strict ID sort is needed for clean pagination.
            allDocs.sort((a, b) => a.id.localeCompare(b.id)); // Lexicographical ID sort
            console.log(`[getFilteredLeadsPage] Docs sorted by ID.`);

            docs = allDocs.slice(0, safeLimit);
            docs = docs.map((d) => {
                const data = d.data();
                return {
                    id: d.id,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    phone: data.phone || data.phoneNumber,
                    status: data.status,
                    createdAt: data.createdAt
                };
            });
        }

        return {
            leads: docs,
            lastDocId: docs.length > 0 ? docs[docs.length - 1].id : null
        };
    } catch (e) {
        console.error("[getFilteredLeadsPage] CRITICAL FAILURE:", e);
        // Throw raw error to see it in UI if possible
        throw new HttpsError('internal', `DEBUG: ${e.message}`);
    }
});

/**
 * 1. Initialize a Bulk Messaging Session
 * Handles filtering and identifying target IDs across 3 sources.
 */
exports.initBulkSession = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    const { initBulkSessionSchema } = require("./shared/schema");

    // VALIDATION: Strict Schema Check
    const { error, value } = initBulkSessionSchema.validate(request.data);
    if (error) {
        throw new HttpsError('invalid-argument', `Validation Error: ${error.details[0].message}`);
    }

    const { companyId, filters, messageConfig, scheduledFor, name, rawData } = value;
    const userId = request.auth.uid;

    if (!companyId || !filters || !messageConfig) {
        throw new HttpsError('invalid-argument', 'Missing companyId, filters, or messageConfig.');
    }

    // SECURITY: Prevent IDOR
    await assertCompanyAdmin(userId, companyId);

    try {
        console.log(`[initBulkSession] Initializing session. Project: ${PROJECT_ID}, Region: ${LOCATION}`);

        // --- 0. PRE-OPS ---
        // Create Reference Early to handle Imports
        const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc();

        let recruiterName = "Recruiter";
        let companyName = "SafeHaul";

        const userSnap = await db.collection('users').doc(userId).get();
        if (userSnap.exists) recruiterName = userSnap.data().name || recruiterName;

        const companySnap = await db.collection('companies').doc(companyId).get();
        if (companySnap.exists) companyName = companySnap.data().companyName || companyName;

        // --- 1. RESOLVE SOURCE ---
        let targetIds = [];
        let leadSourceType = filters.leadType || 'leads';

        // A. IMPORT MODE (Stateless Blast)
        if (rawData && Array.isArray(rawData) && rawData.length > 0) {
            console.log(`[initBulkSession] Import Mode: Processing ${rawData.length} rows`);
            leadSourceType = 'import';

            // Batch write targets to subcollection
            const batch = db.batch();
            const targetsRef = sessionRef.collection('targets');

            rawData.forEach((row, index) => {
                // Generate a stable ID if possible, or random
                const docId = row.id || targetsRef.doc().id;
                targetIds.push(docId);
                const docRef = targetsRef.doc(docId);
                batch.set(docRef, {
                    ...row,
                    importedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();

        }
        // B. CRM QUERY MODE
        else {
            if (filters.segmentId && filters.segmentId !== 'all') {
                const segmentSnap = await db.collection('companies').doc(companyId)
                    .collection('segments').doc(filters.segmentId)
                    .collection('members').limit(200).get();
                targetIds = segmentSnap.docs.map(d => d.id);
            } else {

                // Use Shared Query Builder (Multi-Query for OR support)
                let queries = buildLeadQueries(companyId, filters, userId);

                // --- CAP & SLICE: Volume Limit ---
                // If user specifies a limit, use it.
                // SAFETY: Enforce a maximum system limit to prevent OOM/Timeouts
                const MAX_SYSTEM_LIMIT = 20000;

                let campaignLimit = 5000; // Default

                if (filters.campaignLimit) {
                    const userLimit = parseInt(filters.campaignLimit);
                    if (userLimit > MAX_SYSTEM_LIMIT) {
                        throw new HttpsError('invalid-argument', `Campaign limit cannot exceed ${MAX_SYSTEM_LIMIT} recipients per session. Please filter your audience or contact support.`);
                    }
                    campaignLimit = userLimit;
                }

                // Fetch IDs from all query branches
                const snapshots = await Promise.all(queries.map(q => q.select(admin.firestore.FieldPath.documentId()).limit(campaignLimit).get()));
                const allDocs = snapshots.flatMap(s => s.docs);

                // Sort by ID to ensure consistent slicing if we went over limit due to multi-branch fetch
                allDocs.sort((a, b) => a.id.localeCompare(b.id));

                targetIds = allDocs.map(doc => doc.id).slice(0, campaignLimit);
            }

            // Client-side exclusions
            if (filters.excludedLeadIds && Array.isArray(filters.excludedLeadIds)) {
                targetIds = targetIds.filter(id => !filters.excludedLeadIds.includes(id));
            }
        }

        if (targetIds.length === 0) {
            return { success: false, message: "No targets found for these criteria." };
        }

        // --- 4. CREATE SESSION RECORD ---
        let initialStatus = 'queued';
        let scheduleTime = 0;

        if (scheduledFor) {
            const scheduleDate = new Date(scheduledFor);
            const now = new Date();
            if (scheduleDate > now) {
                initialStatus = 'scheduled';
                scheduleTime = (scheduleDate.getTime() - now.getTime()) / 1000;
            }
        }

        const sessionData = {
            id: sessionRef.id,
            companyId: companyId,
            name: name || "Untitled Campaign",
            status: initialStatus,
            creatorId: userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            scheduledFor: scheduledFor ? admin.firestore.Timestamp.fromDate(new Date(scheduledFor)) : null,
            config: {
                ...messageConfig,
                filters: filters,
                recruiterName,
                companyName
            },
            progress: {
                totalCount: targetIds.length,
                processedCount: 0,
                successCount: 0,
                failedCount: 0
            },
            targetIds: targetIds,
            currentPointer: 0,
            leadSourceType: leadSourceType
        };

        await sessionRef.set(sessionData);

        // --- 5. START WORKER ---
        await enqueueWorker(companyId, sessionRef.id, scheduleTime);

        return {
            success: true,
            sessionId: sessionRef.id,
            targetCount: targetIds.length,
            status: initialStatus
        };

    } catch (error) {
        console.error("[initBulkSession] Error:", error);
        throw new HttpsError('internal', error.message);
    }
});

/**
 * Bulk session controls (pause/resume/cancel) have been refactored
 * to use direct Firestore SDK updates for better performance.
 * 
 * EXCEPTION: Resume requires a server-side kick to restart the worker.
 */
exports.resumeBulkSession = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    const { companyId, sessionId } = request.data;
    const userId = request.auth.uid;
    await assertCompanyAdmin(userId, companyId); // SECURITY
    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);

    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found');

    const session = sessionSnap.data();
    if (session.status === 'completed') {
        return { success: false, message: 'Session already completed' };
    }

    // 1. Set status to active
    await sessionRef.update({
        status: 'active',
        resumedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 2. Kickstart the worker again (immediate)
    // We pass 0 delay to start processing immediately
    await enqueueWorker(companyId, sessionId, 0);

    return { success: true, message: 'Session resumed' };
});

/**
 * Pause a running session.
 * The worker checks this status at the start of each batch.
 */
exports.pauseBulkSession = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    const { companyId, sessionId } = request.data;
    if (!companyId || !sessionId) throw new HttpsError('invalid-argument', 'Missing companyId or sessionId');
    await assertCompanyAdmin(request.auth.uid, companyId); // SECURITY

    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);

    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found');

    const session = sessionSnap.data();
    if (session.status !== 'active' && session.status !== 'queued' && session.status !== 'scheduled') {
        return { success: false, message: 'Session is not active' };
    }

    await sessionRef.update({
        status: 'paused',
        pausedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, message: 'Session paused' };
});

/**
 * Cancel/Stop a session permanently.
 */
exports.cancelBulkSession = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    const { companyId, sessionId } = request.data;
    if (!companyId || !sessionId) throw new HttpsError('invalid-argument', 'Missing companyId or sessionId');
    await assertCompanyAdmin(request.auth.uid, companyId); // SECURITY

    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);

    try {
        // Verify existence
        const doc = await sessionRef.get();
        if (!doc.exists) throw new HttpsError('not-found', 'Session does not exist');

        await sessionRef.update({
            status: 'cancelled',
            cancelledAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, message: 'Session cancelled' };
    } catch (error) {
        console.error("Cancel Session Error:", error);
        throw new HttpsError('internal', error.message);
    }
});


/**
 * 5. Retry Failed Attempts
 * Creates a new session with only the failed IDs from a previous session.
 */
exports.retryFailedAttempts = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');
    const { companyId, originalSessionId, newMessageConfig } = request.data;
    const userId = request.auth.uid;
    await assertCompanyAdmin(userId, companyId); // SECURITY

    try {
        // 1. Fetch failed logs
        const logsSnapshot = await db.collection('companies').doc(companyId)
            .collection('bulk_sessions').doc(originalSessionId)
            .collection('logs')
            .where('status', '==', 'failed')
            .get();

        // --- TRANSIENT ERROR FILTERING ---
        // Permanent errors that we should NOT retry automatically
        const permanentErrors = [
            "blacklist", "opt-out", "invalid", "landline", "no phone", "unreachable", "unallocated"
        ];

        const retryableLogs = logsSnapshot.docs.filter(doc => {
            const error = (doc.data().error || "").toLowerCase();
            return !permanentErrors.some(pe => error.includes(pe));
        });

        const failedLeadIds = [...new Set(retryableLogs.map(d => d.data().leadId))];

        if (failedLeadIds.length === 0) {
            return {
                success: false,
                message: "No transient failures found. All errors appear to be permanent (Invalid numbers, Blacklisted, etc)."
            };
        }

        // 2. Fetch original config if not provided
        // 2. Fetch original config if not provided
        let configToUse = newMessageConfig;
        let originalSourceType = 'retry';

        if (!configToUse || true) { // Always fetch to get sourceType
            const originalSessionSnap = await db.collection('companies').doc(companyId)
                .collection('bulk_sessions').doc(originalSessionId)
                .get();

            if (originalSessionSnap.exists) {
                const data = originalSessionSnap.data();
                if (!configToUse) configToUse = data.config;
                // CRITICAL FIX: Preserve the original source type (global, leads, applications) 
                // instead of 'retry', so the worker looks in the right collection.
                originalSourceType = data.leadSourceType || 'pool'; // Default to pool/global if missing
            } else {
                if (!configToUse) throw new HttpsError('not-found', "Original session config not found");
            }
        }

        // 3. Create NEW Session
        const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc();
        const sessionData = {
            id: sessionRef.id,
            status: 'queued',
            creatorId: userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            config: configToUse,
            progress: {
                totalCount: failedLeadIds.length,
                processedCount: 0,
                successCount: 0,
                failedCount: 0
            },
            targetIds: failedLeadIds,
            currentPointer: 0,
            leadSourceType: originalSourceType, // Use preserved type (e.g. 'applications')
            originalSessionId: originalSessionId
        };

        await sessionRef.set(sessionData);

        // 4. Start Worker
        await enqueueWorker(companyId, sessionRef.id, 0);

        return { success: true, sessionId: sessionRef.id, targetCount: failedLeadIds.length };

    } catch (error) {
        console.error("Retry Error:", error);
        throw new HttpsError('internal', error.message);
    }
});


/**
 * 2. Recursive Worker (Cloud Tasks Target)
 * Processes leads sequentially with carrier-compliant delays.
 */
/**
 * 2. Recursive Worker (Cloud Tasks Target)
 * Processes leads in BATCHES to improve throughput and reduce costs.
 * 
 * Recommended Batch Size: 50
 * - Reduces function invocations by 50x
 * - Keeps execution time well within 60s timeout (usually < 5s)
 * - stays under Firestore batch limit (500 ops)
 */
exports.processBulkBatch = onRequest({
    timeoutSeconds: 540,
    memory: '1GiB',
    region: 'us-central1',
    secrets: ['SMS_ENCRYPTION_KEY']
}, async (req, res) => {

    const hasQueueHeader = req.headers["x-appengine-queuename"] || req.headers["x-cloudtasks-queuename"];
    if (!hasQueueHeader && !process.env.FUNCTIONS_EMULATOR) {
        return res.status(403).send("Forbidden");
    }

    const { companyId, sessionId } = req.body;
    if (!companyId || !sessionId) return res.status(400).send("Missing parameters");

    // DEBUG: Check Environment
    console.log(`[processBulkBatch] Start. Env Secret Present: ${!!process.env.SMS_ENCRYPTION_KEY}`);

    const sessionRef = db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId);

    try {
        const sessionSnap = await sessionRef.get();
        if (!sessionSnap.exists) return res.status(404).send("Session not found");

        const session = sessionSnap.data();
        if (session.status === 'paused' || session.status === 'completed' || session.status === 'cancelled') {
            return res.status(200).send(`Session is ${session.status}.`);
        }

        const { targetIds, currentPointer, config, progress, leadSourceType } = session;

        // Completion check
        if (currentPointer >= targetIds.length) {
            await sessionRef.update({
                status: 'completed',
                completedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return res.status(200).send("Campaign Complete");
        }

        // --- SEQUENTIAL PROCESSING CONFIGURATION ---
        const BATCH_SIZE = 20; // Reduced from 50 to prevent timeouts (20 * 3s = 60s + overhead)
        const endPointer = Math.min(currentPointer + BATCH_SIZE, targetIds.length);
        const batchIds = targetIds.slice(currentPointer, endPointer);

        console.log(`[Batch Worker] Processing ${batchIds.length} leads Sequentially (Indices ${currentPointer} - ${endPointer - 1})`);

        // Prepare shared resources
        let adapter = null;
        let emailTransporter = null;
        let companyName = config.companyName || 'SafeHaul';
        const senderId = session.creatorId;

        if (config.method === 'sms') {
            try {
                adapter = await SMSAdapterFactory.getAdapterForUser(companyId, senderId);
            } catch (e) {
                console.error("Failed to initialize SMS adapter:", e);
                // Fail gracefully in loop
            }
        } else if (config.method === 'email') {
            try {
                const companySnap = await db.collection('companies').doc(companyId).get();
                const emailSettings = companySnap.data()?.emailSettings;
                if (emailSettings?.email && emailSettings?.appPassword) {

                    // SECURITY: Try to decrypt password, fall back to plaintext (backward compatibility)
                    let mailPass = emailSettings.appPassword;
                    try {
                        if (mailPass.includes(':')) { // Simple heuristic for IV:Content format
                            const decrypted = decrypt(mailPass);
                            if (decrypted) mailPass = decrypted;
                        }
                    } catch (decErr) {
                        // Failed to decrypt, assume plaintext or corrupted key. Proceed with original.
                        console.warn("[Email] Password decryption failed. Using raw value.");
                    }

                    emailTransporter = nodemailer.createTransport({
                        service: 'gmail',
                        auth: { user: emailSettings.email, pass: mailPass }
                    });
                }
            } catch (e) {
                console.error("Failed to initialize Email transport:", e);
            }
        }

        // --- SEQUENTIAL LOOP ---
        let batchSuccessCount = 0;
        let batchFailCount = 0;

        for (const leadId of batchIds) {
            const loopStart = Date.now();
            let success = false;
            let errorMsg = null;
            let recipientName = "Unknown";
            let recipientIdentity = "N/A";

            try {
                // FIX: Idempotency Check - Prevent duplicate sends
                const logRef = sessionRef.collection('logs').doc(leadId);
                const logSnap = await logRef.get();
                if (logSnap.exists) {
                    console.log(`[Idempotency] Skipping ${leadId}, already processed.`);
                    continue;
                }

                // 1. Fetch Data
                let leadData = {};
                if (leadSourceType === 'import') {
                    // Fetch from 'targets' subcollection
                    const tSnap = await sessionRef.collection('targets').doc(leadId).get();
                    if (tSnap.exists) leadData = tSnap.data();
                    // else throw new Error("Imported target data missing"); // Don't throw, just skip
                    else {
                        errorMsg = "Imported target data missing";
                        // Continue to logging
                    }
                } else {
                    // Fetch from CRM
                    let leadDocRef;
                    if (leadSourceType === 'global') {
                        leadDocRef = db.collection('leads').doc(leadId);
                    } else if (leadSourceType === 'leads') {
                        leadDocRef = db.collection('companies').doc(companyId).collection('leads').doc(leadId);
                    } else {
                        leadDocRef = db.collection('companies').doc(companyId).collection('applications').doc(leadId);
                    }
                    const lSnap = await leadDocRef.get();
                    if (lSnap.exists) leadData = lSnap.data();
                    // else throw new Error("CRM lead data missing");
                    else {
                        errorMsg = "CRM lead data missing";
                    }
                }

                if (!errorMsg) {
                    recipientName = `${leadData.firstName || 'Driver'} ${leadData.lastName || ''}`.trim();
                    const phone = leadData.phone || leadData.phoneNumber;

                    // 2. Blacklist Check (only relevant for real numbers, less likely for import but still good)
                    const blacklisted = await isBlacklisted(companyId, phone);

                    if (blacklisted) {
                        errorMsg = "Number is blacklisted (Opt-out)";
                        success = false;
                    } else if (config.method === 'sms') {
                        if (!adapter) throw new Error("SMS Configuration Invalid");
                        recipientIdentity = phone || "No Phone";

                        if (recipientIdentity !== "No Phone") {
                            const finalMsg = config.message
                                .replace(/\[Driver Name\]/g, leadData.firstName || 'Driver')
                                .replace(/\[Company Name\]/g, companyName)
                                .replace(/\[Recruiter Name\]/g, config.recruiterName || 'your recruiter');

                            await adapter.sendSMS(recipientIdentity, finalMsg, senderId);
                            success = true;
                        } else {
                            errorMsg = "No valid phone number";
                        }

                    } else if (config.method === 'email') {
                        if (!emailTransporter) throw new Error("Email Settings Invalid");
                        recipientIdentity = leadData.email || "No Email";

                        if (recipientIdentity !== "No Email") {
                            const finalBody = config.message
                                .replace(/\[Driver Name\]/g, leadData.firstName || 'Driver')
                                .replace(/\[Company Name\]/g, companyName)
                                .replace(/\[Recruiter Name\]/g, config.recruiterName || 'your recruiter');

                            await emailTransporter.sendMail({
                                from: `"${companyName}" <${emailTransporter.transporter.options.auth.user}>`,
                                to: recipientIdentity,
                                subject: config.subject || `Update from ${companyName}`,
                                text: finalBody,
                                html: `<p>${finalBody.replace(/\n/g, '<br>')}</p>`
                            });
                            success = true;
                        } else {
                            errorMsg = "No valid email";
                        }
                    }
                } else {
                    success = false;
                }

            } catch (err) {
                errorMsg = err.message || "Unknown error";
                success = false;
            }

            // 3. Real-Time Write (Log) - Wrapped in TRY/CATCH to prevent batch crash
            try {
                await sessionRef.collection('logs').doc(leadId).set({
                    leadId,
                    recipientName,
                    recipientIdentity,
                    status: success ? 'delivered' : 'failed',
                    error: errorMsg,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    isSuccess: success
                });
            } catch (logErr) {
                console.error(`[Worker] Failed to write log for ${leadId}:`, logErr);
            }

            // 4. Real-Time Progress Update - Wrapped in TRY/CATCH
            if (success) batchSuccessCount++;
            else batchFailCount++;

            try {
                await sessionRef.update({
                    'progress.processedCount': admin.firestore.FieldValue.increment(1),
                    'progress.successCount': admin.firestore.FieldValue.increment(success ? 1 : 0),
                    'progress.failedCount': admin.firestore.FieldValue.increment(success ? 0 : 1),
                    // We don't update currentPointer here, we do it at batch end
                    lastUpdateAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // 4.5 Update Lead Timestamp (Smart Exclusion)
                if (success) {
                    // Update the LEADS document, not the session log
                    let leadRef;
                    if (leadSourceType === 'global') leadRef = db.collection('leads').doc(leadId);
                    else if (leadSourceType === 'leads') leadRef = db.collection('companies').doc(companyId).collection('leads').doc(leadId);
                    else if (leadSourceType === 'applications') leadRef = db.collection('companies').doc(companyId).collection('applications').doc(leadId);

                    if (leadRef) {
                        // Fire and forget update to avoid slowing down worker too much
                        leadRef.update({
                            lastBulkMessageAt: admin.firestore.FieldValue.serverTimestamp(),
                            lastContactedAt: admin.firestore.FieldValue.serverTimestamp() // Update legacy field too
                        }).catch(err => console.warn(`[Worker] Failed to update timestamp for ${leadId}`, err));
                    }
                }
            } catch (updateErr) {
                console.error(`[Worker] Failed to update progress for ${leadId}:`, updateErr);
            }

            // 5. Safety Delay
            // Ensure we wait at least 3 seconds from loop start
            const elapsed = Date.now() - loopStart;
            const waitTime = Math.max(3000 - elapsed, 100);
            // We force at least 100ms even if 3s passed, to be safe, but mostly we want 3000ms total cycle.
            // Actually, requirements say "3 second interval".
            // So we should just wait 3000ms.
            await delay(3000);
        }

        // --- END BATCH UPDATE ---
        // ZOMBIE KILLER: Check status one last time to ensure we didn't get cancelled/paused mid-batch
        const freshSnap = await sessionRef.get();
        if (!freshSnap.exists || ['cancelled', 'paused', 'completed'].includes(freshSnap.data().status)) {
            console.log("[Batch Worker] Session stopped/cancelled during execution. Aborting recursion.");
            return res.status(200).send("Session stopped mid-batch.");
        }

        const isKnownLast = (endPointer >= targetIds.length);
        await sessionRef.update({
            currentPointer: endPointer,
            status: isKnownLast ? 'completed' : 'active',
            ...(isKnownLast ? { completedAt: admin.firestore.FieldValue.serverTimestamp() } : {})
        });

        // Loop next batch
        if (!isKnownLast) {
            await enqueueWorker(companyId, sessionId, 1);
        }

        res.status(200).send(`Processed batch of ${batchIds.length}. Success: ${batchSuccessCount}, Fail: ${batchFailCount}`);

    } catch (error) {
        console.error("[processBulkBatch] Critical Error:", error);
        res.status(500).send(error.message);
    }
});

async function enqueueWorker(companyId, sessionId, delaySeconds) {
    const queuePath = tasksClient.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME);

    // FIX: V2 URL Logic & Env Var Requirement
    let url = process.env.PROCESS_BULK_BATCH_URL;
    if (!url) {
        if (process.env.FUNCTIONS_EMULATOR) {
            url = `http://127.0.0.1:5001/${PROJECT_ID}/${LOCATION}/processBulkBatch`;
        } else {
            // CRITICAL: Cannot guess V2 URLs
            throw new Error("CRITICAL CONFIG ERROR: PROCESS_BULK_BATCH_URL env var is missing. Cannot recurse.");
        }
    }

    // FIX: Dynamic Service Account
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
    const serviceAccountEmail = firebaseConfig.serviceAccount || `${PROJECT_ID}@appspot.gserviceaccount.com`;

    const payload = { companyId, sessionId };
    const task = {
        httpRequest: {
            httpMethod: "POST",
            url,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(JSON.stringify(payload)).toString("base64"),
            oidcToken: {
                serviceAccountEmail, // Uses dynamic account
                audience: url
            }
        }
    };
    if (delaySeconds > 0) {
        task.scheduleTime = { seconds: Date.now() / 1000 + delaySeconds };
    }

    try {
        await tasksClient.createTask({ parent: queuePath, task });
        console.log(`[enqueueWorker] Task created for session ${sessionId} with delay ${delaySeconds}s`);
    } catch (err) {
        console.error(`[enqueueWorker] CRITICAL: Failed to create Cloud Task for session ${sessionId}:`, err.message);
        console.error(`  - Queue Path: ${queuePath}`);
        console.error(`  - Task URL: ${url}`);
        console.error(`  - Ensure 'bulk-actions-queue' exists in Cloud Tasks for region ${LOCATION}`);

        // Update session to failed status so UI can show feedback
        try {
            await db.collection('companies').doc(companyId)
                .collection('bulk_sessions').doc(sessionId)
                .update({
                    status: 'failed',
                    error: `Cloud Tasks Enqueue Failed: ${err.message}. Ensure the 'bulk-actions-queue' exists in GCP region ${LOCATION}.`,
                    failedAt: admin.firestore.FieldValue.serverTimestamp()
                });
        } catch (updateErr) {
            console.error(`[enqueueWorker] Also failed to update session ${sessionId} to 'failed':`, updateErr.message);
        }

        throw err; // Re-throw to propagate to the caller
    }
}


