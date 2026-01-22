// functions/leadLogic.js
const { admin, db, auth } = require("./firebaseAdmin");
const { CloudTasksClient } = require("@google-cloud/tasks");
const { logger } = require("firebase-functions");

// --- CLOUD TASKS CONFIG (Dynamic for multi-environment support) ---
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'truckerapp-system';
const LOCATION = process.env.FUNCTION_REGION || 'us-central1';
const QUEUE_NAME = "lead-distribution-queue";
const tasksClient = new CloudTasksClient();

// --- CONSTANTS (PRESERVED - defaults, can be overridden by system_settings) ---
let QUOTA_FREE = 50;
let QUOTA_PAID = 200;
const EXPIRY_SHORT_MS = 24 * 60 * 60 * 1000; // 24 Hours
const EXPIRY_LONG_MS = 7 * 24 * 60 * 60 * 1000; // 7 Days
const POOL_COOL_OFF_DAYS = 7;
const POOL_INTEREST_LOCK_DAYS = 7;
const POOL_HIRED_LOCK_DAYS = 60;

const ENGAGED_STATUSES = [
    "Contacted", "Application Started", "Offer Sent", "Offer Accepted", "Interview Scheduled", "Hired", "Approved"
];
const TERMINAL_STATUSES = [
    "Wrong Number", "Not Interested", "Rejected", "Disqualified", "Hired Elsewhere"
];

// --- HELPER: Fetch System Settings from Firestore ---
async function getSystemSettings() {
    try {
        const settingsSnap = await db.collection("system_settings").doc("distribution").get();
        if (settingsSnap.exists) {
            const data = settingsSnap.data();
            return {
                quotaPaid: data.quota_paid || 200,
                quotaFree: data.quota_free || 50,
                maintenanceMode: data.maintenance_mode || false
            };
        }
    } catch (e) {
        logger.warn("Could not fetch system_settings, using defaults:", { error: e.message });
    }
    return { quotaPaid: 200, quotaFree: 50, maintenanceMode: false };
}

// --- 1. THE DEALER ENGINE V4 (Cloud Tasks Parallel) ---
async function runLeadDistribution(forceRotate = false) {
    logger.info(`Starting 'THE DEALER' Engine V4 PARALLEL (Force Rotate: ${forceRotate})...`);

    try {
        // 1. Check for maintenance mode
        const settings = await getSystemSettings();
        if (settings.maintenanceMode) {
            console.log("Maintenance mode is ON. Skipping distribution.");
            return { success: false, message: "Maintenance mode is enabled." };
        }

        // Update quotas from settings
        QUOTA_FREE = settings.quotaFree;
        QUOTA_PAID = settings.quotaPaid;

        // 2. Get all active companies
        const companiesSnap = await db.collection("companies").where("isActive", "==", true).get();
        if (companiesSnap.empty) {
            return { success: false, message: "No active companies found." };
        }

        const companies = companiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`Found ${companies.length} active companies. Creating Cloud Tasks...`);

        // 3. Create a Cloud Task for EACH company (parallel execution)
        const queuePath = tasksClient.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME);
        const workerUrl = `https://${LOCATION}-${PROJECT_ID}.cloudfunctions.net/processCompanyDistribution`;

        const taskPromises = companies.map(async (company) => {
            const isPaid = company.planType?.toLowerCase() === 'paid';
            let quota = isPaid ? QUOTA_PAID : QUOTA_FREE;
            if (company.dailyLeadQuota && company.dailyLeadQuota > quota) {
                quota = company.dailyLeadQuota;
            }

            const payload = {
                companyId: company.id,
                quotaOverride: quota,
                forceRotate: forceRotate
            };

            const task = {
                httpRequest: {
                    httpMethod: "POST",
                    url: workerUrl,
                    headers: { "Content-Type": "application/json" },
                    body: Buffer.from(JSON.stringify(payload)).toString("base64")
                }
            };

            try {
                const [response] = await tasksClient.createTask({ parent: queuePath, task });
                return { company: company.companyName, taskName: response.name, status: "queued" };
            } catch (err) {
                console.error(`Failed to queue task for ${company.companyName}:`, err.message);
                return { company: company.companyName, error: err.message, status: "failed" };
            }
        });

        const results = await Promise.all(taskPromises);
        const queued = results.filter(r => r.status === "queued").length;
        const failed = results.filter(r => r.status === "failed").length;

        console.log(`Cloud Tasks created: ${queued} queued, ${failed} failed`);
        return {
            success: true,
            message: `Dealer V4 Complete: ${queued} tasks queued, ${failed} failed`,
            details: results
        };

    } catch (globalError) {
        console.error("FATAL DISTRIBUTION ERROR:", globalError);
        throw globalError;
    }
}

// --- 2. DEALER LOGIC (Per Company) ---
async function dealLeadsToCompany(company, planLimit, forceRotate) {
    const companyId = company.id;
    const now = new Date();
    const nowTs = admin.firestore.Timestamp.now();

    const activeWorkingCount = await processCompanyCleanup(companyId, now, forceRotate);
    const needed = Math.max(0, planLimit - activeWorkingCount);

    if (needed <= 0) return `${company.companyName}: Full (${activeWorkingCount}/${planLimit})`;

    const buffer = Math.ceil(needed * 1.5);
    let candidates = [];

    const freshSnap = await db.collection("leads").where("unavailableUntil", "==", null).limit(buffer).get();
    freshSnap.forEach(doc => candidates.push(doc));

    if (candidates.length < buffer) {
        const remaining = buffer - candidates.length;
        const expiredSnap = await db.collection("leads").where("unavailableUntil", "<=", nowTs).limit(remaining).get();
        expiredSnap.forEach(doc => candidates.push(doc));
    }

    candidates = candidates.sort(() => Math.random() - 0.5);

    let added = 0;
    for (const leadDoc of candidates) {
        if (added >= needed) break;
        const success = await assignLeadTransaction(companyId, leadDoc, nowTs);
        if (success) added++;
    }
    return `${company.companyName}: Active ${activeWorkingCount}, Added ${added} (Target: ${planLimit})`;
}

// --- 3. TRANSACTIONAL ASSIGNMENT (REFERENCE-BASED MODEL) ---
// Instead of copying all lead data, we store only a reference + operational fields.
// This eliminates data duplication and reduces ghost lead complexity.
// Frontend uses useLeadWithSource hook to hydrate the reference.
async function assignLeadTransaction(companyId, leadDocRef, nowTs) {
    try {
        await db.runTransaction(async (t) => {
            const freshDoc = await t.get(leadDocRef.ref);
            if (!freshDoc.exists) throw new Error("GHOST_LEAD");
            const data = freshDoc.data();
            if (data.unavailableUntil && data.unavailableUntil.toMillis() > Date.now()) {
                throw new Error("ALREADY_LOCKED");
            }
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const companyLeadRef = db.collection("companies").doc(companyId).collection("leads").doc(freshDoc.id);

            // REFERENCE-BASED PAYLOAD
            // Only store: reference to source + company-specific operational fields
            // Source data (firstName, phone, etc.) is fetched via leadRef on frontend
            const payload = {
                // Reference to source document (single source of truth)
                leadRef: `leads/${freshDoc.id}`,
                originalLeadId: freshDoc.id,

                // Essential display fields (cached for list views to avoid N+1 queries)
                // These are denormalized for performance but leadRef is the source of truth
                firstName: data.firstName || 'Unknown',
                lastName: data.lastName || 'Driver',
                phone: data.phone || '',
                email: data.email || '',

                // Platform metadata
                isPlatformLead: true,
                distributedAt: nowTs,
                source: data.source || 'SafeHaul Network',

                // Company-specific operational fields (these are NOT in source)
                status: "New Lead",
                assignedTo: null,
                lastContactedAt: null,
                lastCallOutcome: null,
                notes: [],
                callAttempts: 0
            };

            t.set(companyLeadRef, payload);
            t.update(leadDocRef.ref, {
                unavailableUntil: admin.firestore.Timestamp.fromDate(tomorrow),
                lastAssignedTo: companyId,
                visitedCompanyIds: admin.firestore.FieldValue.arrayUnion(companyId)
            });
        });
        return true;
    } catch (e) { return false; }
}

// --- 4. GHOST-PROOF CLEANUP LOGIC ---
async function processCompanyCleanup(companyId, now, forceRotate) {
    const companyLeadsRef = db.collection("companies").doc(companyId).collection("leads");
    const currentLeadsSnap = await companyLeadsRef.where("isPlatformLead", "==", true).get();

    let batch = db.batch();
    let batchSize = 0;
    let workingCount = 0;

    for (const docSnap of currentLeadsSnap.docs) {
        const data = docSnap.data();
        let shouldDelete = false;
        const status = data.status || "New Lead";
        const isEngaged = ENGAGED_STATUSES.includes(status) && status !== "New Lead" && status !== "Attempted";
        const isTerminal = TERMINAL_STATUSES.includes(status);

        if (isTerminal) shouldDelete = true;
        else if (forceRotate && !isEngaged) shouldDelete = true;
        else if (data.distributedAt) {
            const age = now.getTime() - data.distributedAt.toDate().getTime();
            if (age > EXPIRY_LONG_MS) {
                if (!["Hired", "Offer Accepted", "Approved"].includes(status)) shouldDelete = true;
            } else if (age > EXPIRY_SHORT_MS && !isEngaged) shouldDelete = true;
        } else shouldDelete = true;

        if (shouldDelete) {
            await harvestNotesBeforeDelete(docSnap, data);
            batch.delete(docSnap.ref);
            batchSize++;
            if (data.originalLeadId && !isTerminal) {
                const globalRef = db.collection("leads").doc(data.originalLeadId);
                const globalSnap = await globalRef.get();
                if (globalSnap.exists) {
                    batch.update(globalRef, { unavailableUntil: null, lastAssignedTo: null });
                }
            }
        } else workingCount++;

        if (batchSize >= 400) { await batch.commit(); batch = db.batch(); batchSize = 0; }
    }
    if (batchSize > 0) await batch.commit();
    return workingCount;
}

// --- 5. UPDATED ENTRY POINTS (FIXED FOR CALLABLES) ---

async function confirmDriverInterest(data) {
    const { leadId, companyIdOrSlug, recruiterId } = data;
    if (!leadId || !companyIdOrSlug) return { success: false, error: "Missing parameters." };

    const companyQuery = await db.collection("companies").where("appSlug", "==", companyIdOrSlug).limit(1).get();
    let companyId = companyQuery.empty ? companyIdOrSlug : companyQuery.docs[0].id;

    const leadSnap = await db.collection("leads").doc(leadId).get();
    if (!leadSnap.exists) return { success: false, error: "Lead not found." };

    const lockTs = admin.firestore.Timestamp.fromDate(new Date(Date.now() + POOL_INTEREST_LOCK_DAYS * 24 * 60 * 60 * 1000));

    // ISOLATION FIX: Do not copy previous operational history (from other companies)
    const rawData = leadSnap.data();
    const safePayload = { ...rawData };

    // Whitelist / Blacklist Logic
    const OPERATIONAL_FIELDS = [
        'lastContactedAt', 'lastContactedBy',
        'lastCallOutcome', 'lastOutcome', 'lastOutcomeBy',
        'lastCall', 'status', 'assignedTo', 'convertedAt',
        'subStatus', 'internalNotes', 'lastAssignedTo'
    ];

    OPERATIONAL_FIELDS.forEach(field => delete safePayload[field]);

    const batch = db.batch();
    let assignedTo = null;

    // Resolve Recruiter (if any)
    if (recruiterId) {
        const linkSnap = await db.collection("recruiter_links").doc(recruiterId).get();
        if (linkSnap.exists) {
            assignedTo = linkSnap.data().userId;
        } else {
            // Assume it might be a direct UID
            assignedTo = recruiterId;
        }
    }

    batch.set(db.collection("companies").doc(companyId).collection("applications").doc(leadId), {
        ...safePayload,
        status: "New Application",
        source: "Driver Interest Link",
        isPlatformLead: true,
        originalLeadId: leadId,
        recruiterCode: recruiterId || null,
        assignedTo: assignedTo, // <--- SET ASSIGNED TO
        submittedAt: admin.firestore.Timestamp.now()
    }, { merge: true });

    batch.update(db.collection("leads").doc(leadId), {
        unavailableUntil: lockTs,
        lastAssignedTo: companyId,
        poolStatus: "engaged_interest"
    });

    await batch.commit();
    return { success: true };
}

async function processLeadOutcome(data) {
    const { leadId, companyId, outcome } = data;
    if (!leadId) return { error: "No Lead ID" };

    const leadRef = db.collection("leads").doc(leadId);
    let lockUntil = new Date();
    let reason = "pool_recycle";

    if (outcome === 'hired_elsewhere' || outcome === 'hired' || outcome === 'Approved') {
        lockUntil.setDate(lockUntil.getDate() + POOL_HIRED_LOCK_DAYS);
        reason = "hired";
    } else {
        lockUntil.setDate(lockUntil.getDate() + POOL_COOL_OFF_DAYS);
        reason = "rejected";
    }

    await leadRef.update({
        unavailableUntil: admin.firestore.Timestamp.fromDate(lockUntil),
        lastOutcome: outcome,
        lastOutcomeBy: companyId,
        poolStatus: reason
    });
    return { success: true };
}

// --- 6. PRESERVED FULL HELPERS ---

async function runCleanup() {
    let deletedCount = 0;

    // 1. Cleanup Bad Leads (Existing Logic)
    const leadsSnap = await db.collection("leads").get();
    let batch = db.batch();
    let bSize = 0;
    for (const doc of leadsSnap.docs) {
        const d = doc.data();
        const name = `${d.firstName} ${d.lastName}`.toLowerCase();
        if ((!d.phone && !d.email) || name.includes("test lead") || name.includes("health check")) {
            batch.delete(doc.ref);
            bSize++;
            deletedCount++;
        }
        if (bSize >= 400) { await batch.commit(); batch = db.batch(); bSize = 0; }
    }
    if (bSize > 0) await batch.commit();

    // 2. Cleanup Bad Companies (New Logic)
    let companyDeletedCount = 0;
    const companiesSnap = await db.collection("companies").get();
    let cBatch = db.batch();
    let cSize = 0;

    for (const doc of companiesSnap.docs) {
        const d = doc.data();
        // Invalid if no name OR no createdAt date
        if (!d.companyName || !d.createdAt) {
            cBatch.delete(doc.ref);
            cSize++;
            companyDeletedCount++;
        }
        if (cSize >= 400) { await cBatch.commit(); cBatch = db.batch(); cSize = 0; }
    }
    if (cSize > 0) await cBatch.commit();

    return {
        success: true,
        message: `Cleanup Complete. Purged ${deletedCount} bad leads and ${companyDeletedCount} invalid companies.`
    };
}

async function populateLeadsFromDrivers() {
    let deletedUsers = 0;
    const usersSnap = await db.collection("users").where("role", "==", "driver").get();
    for (const userDoc of usersSnap.docs) {
        try {
            const authRecord = await auth.getUser(userDoc.id);
            if (!authRecord.metadata.lastSignInTime) {
                await auth.deleteUser(userDoc.id);
                await userDoc.ref.delete();
                deletedUsers++;
            }
        } catch (e) {
            if (e.code === 'auth/user-not-found') { await userDoc.ref.delete(); deletedUsers++; }
        }
    }

    const driversSnap = await db.collection("drivers").get();
    let batch = db.batch();
    let added = 0;
    for (const doc of driversSnap.docs) {
        const d = doc.data();
        const leadRef = db.collection("leads").doc(doc.id);
        batch.set(leadRef, {
            firstName: d.personalInfo?.firstName || 'Unknown',
            lastName: d.personalInfo?.lastName || 'Driver',
            email: d.personalInfo?.email || '',
            phone: d.personalInfo?.phone || '',
            driverType: d.driverProfile?.type || 'Unspecified',
            city: d.personalInfo?.city || '',
            state: d.personalInfo?.state || '',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        added++;
    }
    await batch.commit();
    return { success: true, details: `Deleted ${deletedUsers} fake users. Migrated ${added} drivers.` };
}

async function harvestNotesBeforeDelete(docSnap, data) {
    try {
        const notesSnap = await docSnap.ref.collection("internal_notes").get();
        const notesToShare = [];
        notesSnap.forEach(noteDoc => {
            const n = noteDoc.data();
            notesToShare.push({ text: n.text, date: n.createdAt, source: "Previous Recruiter" });
        });
        const originalId = data.originalLeadId || docSnap.id;
        if (originalId && notesToShare.length > 0) {
            await db.collection("leads").doc(originalId).update({
                sharedHistory: admin.firestore.FieldValue.arrayUnion(...notesToShare)
            }).catch(() => { });
        }
    } catch (e) { }
}



// --- CLEANUP JOB: Orphaned Lead References ---
// Scans company leads for orphaned references (where source lead was deleted)
// and either marks them or removes them based on configuration.
async function cleanupOrphanedLeadRefs(options = {}) {
    const { dryRun = true, maxCompanies = 10 } = options;
    const results = { scanned: 0, orphaned: 0, cleaned: 0, errors: [] };

    try {
        const companiesSnap = await db.collection("companies").limit(maxCompanies).get();

        for (const companyDoc of companiesSnap.docs) {
            const companyLeadsSnap = await companyDoc.ref
                .collection("leads")
                .where("isPlatformLead", "==", true)
                .get();

            let batch = db.batch();
            let batchCount = 0;

            for (const leadDoc of companyLeadsSnap.docs) {
                results.scanned++;
                const data = leadDoc.data();
                const sourceId = data.originalLeadId || null;

                if (!sourceId) continue;

                // Check if source document exists
                const sourceRef = db.collection("leads").doc(sourceId);
                const sourceSnap = await sourceRef.get();

                if (!sourceSnap.exists) {
                    results.orphaned++;

                    if (!dryRun) {
                        // Option 1: Mark as orphaned (preserve data)
                        batch.update(leadDoc.ref, {
                            _isOrphaned: true,
                            _orphanedAt: admin.firestore.FieldValue.serverTimestamp()
                        });

                        // Option 2: Delete (uncomment if preferred)
                        // batch.delete(leadDoc.ref);

                        batchCount++;
                        results.cleaned++;

                        if (batchCount >= 400) {
                            await batch.commit();
                            batch = db.batch();
                            batchCount = 0;
                        }
                    }
                }
            }

            if (batchCount > 0) await batch.commit();
        }

        return {
            success: true,
            dryRun,
            ...results,
            message: dryRun
                ? `Dry run complete. Found ${results.orphaned} orphaned leads out of ${results.scanned} scanned.`
                : `Cleanup complete. Marked ${results.cleaned} orphaned leads.`
        };
    } catch (err) {
        console.error("[cleanupOrphanedLeadRefs] Error:", err);
        return { success: false, error: err.message, ...results };
    }
}

module.exports = {
    runLeadDistribution,
    dealLeadsToCompany,  // Exported for worker
    populateLeadsFromDrivers,
    runCleanup,
    processLeadOutcome,
    confirmDriverInterest,
    cleanupOrphanedLeadRefs,  // NEW: Cleanup orphaned references
};
