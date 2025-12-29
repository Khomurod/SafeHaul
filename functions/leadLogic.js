// functions/leadLogic.js
const { admin, db, auth } = require("./firebaseAdmin");

// --- CONSTANTS ---
const QUOTA_FREE = 50;
const QUOTA_PAID = 200;
const EXPIRY_SHORT_MS = 24 * 60 * 60 * 1000; // 24 Hours
const EXPIRY_LONG_MS = 7 * 24 * 60 * 60 * 1000; // 7 Days

// Status Configuration
const ENGAGED_STATUSES = [
    "Contacted", "Application Started", "Offer Sent", "Offer Accepted", "Interview Scheduled", "Hired", "Approved"
];
const TERMINAL_STATUSES = [
    "Wrong Number", "Not Interested", "Rejected", "Disqualified", "Hired Elsewhere"
];

// --- 1. THE DEALER ENGINE V3 (Quota Fix + Ghost Proof) ---
async function runLeadDistribution(forceRotate = false) {
    console.log(`Starting 'THE DEALER' Engine V3 (Force Rotate: ${forceRotate})...`);
    const logs = [];

    try {
        // 1. Get All Active Companies
        const companiesSnap = await db.collection("companies").where("isActive", "==", true).get();
        if (companiesSnap.empty) return { success: false, message: "No active companies found." };

        // 2. Randomize Company Order
        const companies = companiesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
                                            .sort(() => Math.random() - 0.5);

        logs.push(`Processing ${companies.length} active companies.`);

        // 3. THE DEALER LOOP
        for (const company of companies) {
            try {
                // --- QUOTA LOGIC FIX ---
                // Priority: 1. Manual Boost (> Plan) -> 2. Plan Default -> 3. Fallback
                const isPaid = company.planType?.toLowerCase() === 'paid';
                let limit = isPaid ? QUOTA_PAID : QUOTA_FREE;

                // Only allow manual override if it's an UPGRADE (e.g., 500).
                // This ignores the '50' that might have been set by the repair tool on paid plans.
                if (company.dailyLeadQuota && company.dailyLeadQuota > limit) {
                    limit = company.dailyLeadQuota;
                }

                // Run Maintenance + Deal
                const result = await dealLeadsToCompany(company, limit, forceRotate);
                logs.push(result);
            } catch (err) {
                console.error(`DEALER ERROR for ${company.companyName}:`, err);
                logs.push(`${company.companyName}: ERROR - ${err.message}`);
            }
        }

        return { success: true, message: "Dealer Run Complete", details: logs };

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

    // STEP 1: MAINTENANCE CLEANUP
    // Clean up old/bad leads first so we get an accurate count of what's needed.
    const activeWorkingCount = await processCompanyCleanup(companyId, now, forceRotate);

    // STEP 2: CALCULATE NEED
    const needed = Math.max(0, planLimit - activeWorkingCount);

    if (needed <= 0) {
        return `${company.companyName}: Full (${activeWorkingCount}/${planLimit})`;
    }

    // STEP 3: FETCH CANDIDATES
    const buffer = Math.ceil(needed * 1.5); 
    let candidates = [];

    // Priority 1: Fresh Leads
    const freshSnap = await db.collection("leads")
        .where("unavailableUntil", "==", null)
        .limit(buffer)
        .get();
    freshSnap.forEach(doc => candidates.push(doc));

    // Priority 2: Recycled Leads (if needed)
    if (candidates.length < buffer) {
        const remaining = buffer - candidates.length;
        const expiredSnap = await db.collection("leads")
            .where("unavailableUntil", "<=", nowTs)
            .limit(remaining)
            .get();
        expiredSnap.forEach(doc => candidates.push(doc));
    }

    // Shuffle
    candidates = candidates.sort(() => Math.random() - 0.5);

    // STEP 4: TRANSACTIONAL DEAL
    let added = 0;
    for (const leadDoc of candidates) {
        if (added >= needed) break;

        const success = await assignLeadTransaction(companyId, leadDoc, nowTs);
        if (success) added++;
    }

    return `${company.companyName}: Active ${activeWorkingCount}, Added ${added} (Target: ${planLimit})`;
}

// --- 3. TRANSACTIONAL ASSIGNMENT ---
async function assignLeadTransaction(companyId, leadDocRef, nowTs) {
    try {
        await db.runTransaction(async (t) => {
            // 1. Verify Existence
            const freshDoc = await t.get(leadDocRef.ref);
            if (!freshDoc.exists) throw new Error("GHOST_LEAD");

            const data = freshDoc.data();

            // 2. Check Lock
            if (data.unavailableUntil && data.unavailableUntil.toMillis() > Date.now()) {
                throw new Error("ALREADY_LOCKED");
            }

            // 3. Prepare Update
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);

            // Correct Path: companies/{companyId}/leads/{leadId}
            const companyLeadRef = db.collection("companies").doc(companyId).collection("leads").doc(freshDoc.id);

            const payload = {
                firstName: data.firstName || 'Unknown',
                lastName: data.lastName || 'Driver',
                email: data.email || '',
                phone: data.phone || '',
                normalizedPhone: data.normalizedPhone || '',
                driverType: data.driverType || 'Unspecified',
                experience: data.experience || 'N/A',
                city: data.city || '',
                state: data.state || '',
                source: data.source || 'SafeHaul Network',
                sharedHistory: data.sharedHistory || [],

                isPlatformLead: true,
                distributedAt: nowTs,
                originalLeadId: freshDoc.id,
                status: "New Lead",
                assignedTo: null // Visible to all recruiters
            };

            t.set(companyLeadRef, payload);
            t.update(leadDocRef.ref, {
                unavailableUntil: admin.firestore.Timestamp.fromDate(tomorrow),
                lastAssignedTo: companyId,
                visitedCompanyIds: admin.firestore.FieldValue.arrayUnion(companyId)
            });
        });
        return true;
    } catch (e) {
        // Skip silently, log only if important
        return false;
    }
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

        if (isTerminal) {
            shouldDelete = true;
        } else if (forceRotate && !isEngaged) {
            shouldDelete = true;
        } else if (data.distributedAt) {
            const age = now.getTime() - data.distributedAt.toDate().getTime();
            if (age > EXPIRY_LONG_MS) {
                if (!["Hired", "Offer Accepted", "Approved"].includes(status)) shouldDelete = true;
            } else if (age > EXPIRY_SHORT_MS && !isEngaged) {
                shouldDelete = true;
            }
        } else {
            // Bad data (no distribution time)
            shouldDelete = true;
        }

        if (shouldDelete) {
            await harvestNotesBeforeDelete(docSnap, data);
            batch.delete(docSnap.ref);
            batchSize++;

            // GHOST PROOFING: Only try to update global lead if it exists
            if (data.originalLeadId && !isTerminal) {
                const globalRef = db.collection("leads").doc(data.originalLeadId);
                const globalSnap = await globalRef.get(); // Small cost to prevent crash
                if (globalSnap.exists) {
                    batch.update(globalRef, {
                        unavailableUntil: null,
                        lastAssignedTo: null
                    });
                }
            }
        } else {
            workingCount++;
        }

        if (batchSize >= 400) {
            await batch.commit();
            batch = db.batch();
            batchSize = 0;
        }
    }

    if (batchSize > 0) await batch.commit();
    return workingCount;
}

// --- 5. PRESERVED HELPERS ---
async function runCleanup() {
    let deletedCount = 0;
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
    return { success: true, message: `Purged ${deletedCount} bad items.` };
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
            }).catch(() => {});
        }
    } catch (e) { console.warn(`Harvest failed for ${docSnap.id}`, e); }
}

async function processLeadOutcome(leadId, companyId, outcome) {
    if (!leadId) return { error: "No Lead ID" };
    const leadRef = db.collection("leads").doc(leadId);
    const now = new Date();
    let lockUntil = new Date();
    let reason = "pool_recycle";

    if (outcome === 'hired_elsewhere' || outcome === 'hired' || outcome === 'Approved') {
        lockUntil.setDate(now.getDate() + 60); // 60 Days
        reason = "hired";
    } else {
        lockUntil.setDate(now.getDate() + 7); // 7 Days
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

async function confirmDriverInterest(leadId, companyIdOrSlug, recruiterId) {
    const companyQuery = await db.collection("companies").where("appSlug", "==", companyIdOrSlug).limit(1).get();
    let companyId = companyQuery.empty ? companyIdOrSlug : companyQuery.docs[0].id;
    const leadSnap = await db.collection("leads").doc(leadId).get();
    if (!leadSnap.exists) return { success: false, error: "Lead not found." };

    const lockDate = new Date();
    lockDate.setDate(lockDate.getDate() + 7);
    const lockTs = admin.firestore.Timestamp.fromDate(lockDate);

    const batch = db.batch();
    batch.set(db.collection("companies").doc(companyId).collection("applications").doc(leadId), {
        ...leadSnap.data(),
        status: "New Application",
        source: "Driver Interest Link",
        isPlatformLead: true,
        originalLeadId: leadId,
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

async function populateLeadsFromDrivers() {
    return { success: true };
}

async function generateDailyAnalytics() {
    const todayStr = new Date().toISOString().split('T')[0];
    const companiesCount = (await db.collection("companies").count().get()).data().count;
    await db.collection("analytics").doc(todayStr).set({
        date: todayStr,
        metrics: { totalCompanies: companiesCount },
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { success: true };
}

module.exports = {
    runLeadDistribution,
    populateLeadsFromDrivers,
    runCleanup,
    processLeadOutcome,
    confirmDriverInterest,
    generateDailyAnalytics
};