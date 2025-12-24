// functions/leadLogic.js

const { admin, db } = require("./firebaseAdmin");

// --- CONSTANTS ---
const EXPIRY_SHORT_MS = 24 * 60 * 60 * 1000; // 24 Hours
const EXPIRY_LONG_MS = 7 * 24 * 60 * 60 * 1000; // 7 Days

// POOL RULES
const POOL_COOL_OFF_DAYS = 7;
const POOL_INTEREST_LOCK_DAYS = 7;
const POOL_HIRED_LOCK_DAYS = 60;

const ENGAGED_STATUSES = [
    "Contacted", "Application Started", "Offer Sent", "Offer Accepted", "Interview Scheduled", "Hired", "Approved"
];

// --- UTILS ---
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- 1. LEAD DISTRIBUTION ORCHESTRATOR ---
async function runLeadDistribution(forceRotate = false) {
    console.log(`Starting Lead Distribution Engine (Force: ${forceRotate})...`);
    
    // 1. Fetch Companies
    const companiesSnap = await db.collection("companies").get();
    const allCompanyDocs = companiesSnap.docs;
    const allCompanyIds = allCompanyDocs.map(doc => doc.id);

    const distributionDetails = [];
    const now = new Date();
    const nowTs = admin.firestore.Timestamp.now();

    // Track assigned IDs in memory to prevent duplicates within this specific run
    const assignedLeadIds = new Set(); 

    // 2. Process Sequentially (Critical for preventing Race Conditions)
    // We do NOT use Promise.all here because we need the DB locks from Company A 
    // to be committed before Company B queries the pool.
    for (const companyDoc of allCompanyDocs) {
        try {
            const companyId = companyDoc.id;
            const companyData = companyDoc.data();
            const plan = companyData.planType || 'free';
            const LIMIT = plan === 'paid' ? 200 : 50; // Quota

            // A. CLEANUP (Remove expired/unwanted leads)
            const activeCount = await processCompanyCleanup(companyId, now, forceRotate);

            // B. REPLENISH (Fill up to the limit)
            const needed = LIMIT - activeCount;
            let addedCount = 0;
            let msg = "";

            if (needed > 0) {
                addedCount = await processCompanyReplenishment(
                    companyId, 
                    needed, 
                    nowTs, 
                    assignedLeadIds, 
                    allCompanyIds
                );
                msg = `${companyData.companyName}: Active ${activeCount}, Added ${addedCount}`;
            } else {
                msg = `${companyData.companyName}: Full (${activeCount}/${LIMIT})`;
            }
            
            console.log(msg);
            distributionDetails.push(msg);

        } catch (err) {
            console.error(`Error processing company ${companyDoc.id}:`, err);
            distributionDetails.push(`Error ${companyDoc.id}: ${err.message}`);
        }
    }

    return { success: true, message: "Distribution Complete", details: distributionDetails };
}

// --- 2. CLEANUP LOGIC ---
async function processCompanyCleanup(companyId, now, forceRotate) {
    const companyLeadsRef = db.collection("companies").doc(companyId).collection("leads");
    const currentLeadsSnap = await companyLeadsRef.where("isPlatformLead", "==", true).get();

    let batch = db.batch();
    let batchSize = 0; 
    let activeCount = 0;

    for (const docSnap of currentLeadsSnap.docs) {
        const data = docSnap.data();
        let shouldDelete = false;
        const status = data.status || "New Lead";

        const isEngaged = ENGAGED_STATUSES.includes(status) && status !== "New Lead" && status !== "Attempted";

        if (forceRotate && !isEngaged) {
            shouldDelete = true;
        } else {
            if (!data.distributedAt) {
                // If data is malformed and missing distribution time, clean it up
                shouldDelete = true;
            } else {
                const distributedTime = data.distributedAt.toDate().getTime();
                const age = now.getTime() - distributedTime;

                // Rule: If > 7 days and not Hired/Accepted -> Delete
                if (age > EXPIRY_LONG_MS) {
                    if (!["Hired", "Offer Accepted", "Approved"].includes(status)) shouldDelete = true;
                } 
                // Rule: If > 24 hours and untouched -> Delete
                else if (age > EXPIRY_SHORT_MS) {
                    if (!isEngaged) shouldDelete = true;
                }
            }
        }

        if (shouldDelete) {
            // Save notes back to global history before deleting
            await harvestNotesBeforeDelete(docSnap, data);

            // Unlock the lead in the global pool immediately
            if (data.originalLeadId) {
                 const leadRef = db.collection("leads").doc(data.originalLeadId);
                 // We nullify the lock so it can be picked up by others
                 batch.update(leadRef, { 
                    unavailableUntil: null, 
                    lastAssignedTo: null 
                 });
                 batchSize++; 
            }

            batch.delete(docSnap.ref);
            batchSize++;
        } else {
            activeCount++;
        }

        if (batchSize >= 400) { 
            await batch.commit(); 
            batch = db.batch(); 
            batchSize = 0; 
        }
    }

    if (batchSize > 0) {
        await batch.commit();
    }

    return activeCount;
}

// --- 3. REPLENISH LOGIC ---
async function processCompanyReplenishment(companyId, needed, nowTs, assignedLeadIds, allCompanyIds) {
    const companyLeadsRef = db.collection("companies").doc(companyId).collection("leads");

    // Strategy: Fetch more than we need because some will be filtered out (already visited, etc)
    const fetchLimit = (needed * 5) + 10; 

    // Query 1: Leads where lock has expired (unavailableUntil <= NOW)
    // Note: requires Composite Index (unavailableUntil ASC, __name__ DESC)
    const poolQuery = db.collection("leads")
        .where("unavailableUntil", "<=", nowTs)
        .orderBy("unavailableUntil", "asc")
        .limit(fetchLimit);

    let leadDocs = [];
    try {
        const poolSnap = await poolQuery.get();
        leadDocs = poolSnap.docs;

        // Query 2: Leads that are explicitly unlocked (null)
        // Firestores "<=" query does NOT include nulls, so we must query them separately
        if (leadDocs.length < fetchLimit) {
             const nullQuery = db.collection("leads")
                .where("unavailableUntil", "==", null)
                .limit(fetchLimit - leadDocs.length);
             
             const nullSnap = await nullQuery.get();
             // Merge results deduplicating by ID
             const existingIds = new Set(leadDocs.map(d => d.id));
             nullSnap.docs.forEach(d => {
                 if(!existingIds.has(d.id)) leadDocs.push(d);
             });
        }
    } catch (e) {
        console.warn("Pool query warning (Index likely missing, falling back to recent):", e);
        // Fallback: Just get latest leads if index fails
        const backupSnap = await db.collection("leads").orderBy("createdAt", "desc").limit(fetchLimit).get();
        leadDocs = backupSnap.docs;
    }

    // Shuffle to ensure fairness
    leadDocs = shuffleArray(leadDocs);

    let batch = db.batch();
    let batchSize = 0;
    let addedCount = 0;

    for (const leadDoc of leadDocs) {
        // Hard Stop if we filled the quota
        if (addedCount >= needed) break;

        // Skip if assigned to another company in this specific run
        if (assignedLeadIds.has(leadDoc.id)) continue;

        // Double check: Does this company already have this lead? (Safety check)
        const existsCheck = await companyLeadsRef.doc(leadDoc.id).get();
        if (existsCheck.exists) continue;

        const rawData = leadDoc.data();

        // Check if company has already seen this driver
        let visited = rawData.visitedCompanyIds || [];
        if (visited.includes(companyId)) continue;

        // If driver has cycled through everyone, reset the cycle
        if (visited.length >= Math.max(1, allCompanyIds.length - 1)) visited = [];

        // Prepare data for Company Subcollection
        const safeLeadData = {
            firstName: rawData.firstName || 'Unknown',
            lastName: rawData.lastName || 'Driver',
            email: rawData.email || '',
            phone: rawData.phone || '',
            normalizedPhone: rawData.normalizedPhone || '',
            driverType: rawData.driverType || 'Unspecified',
            experience: rawData.experience || 'N/A',
            city: rawData.city || '',
            state: rawData.state || '',
            source: rawData.source || 'SafeHaul Network',
            sharedHistory: rawData.sharedHistory || []
        };

        const distData = {
            ...safeLeadData,
            isPlatformLead: true,
            distributedAt: nowTs,
            originalLeadId: leadDoc.id,
            status: "New Lead"
        };

        // 1. Add to Company
        batch.set(companyLeadsRef.doc(leadDoc.id), distData);
        batchSize++;

        // 2. Lock in Global Pool
        // We lock it for 24h (or until next run) so no one else grabs it immediately
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        db.collection("leads").doc(leadDoc.id).update({ 
            unavailableUntil: admin.firestore.Timestamp.fromDate(tomorrow),
            lastAssignedTo: companyId,
            visitedCompanyIds: [...visited, companyId] // Add to visited list
        });
        batchSize++;

        assignedLeadIds.add(leadDoc.id);
        addedCount++;

        if (batchSize >= 400) { 
            await batch.commit(); 
            batch = db.batch(); 
            batchSize = 0; 
        }
    }

    if (batchSize > 0) {
        await batch.commit();
    }
    return addedCount;
}

// --- 4. OUTCOME HANDLER ---
async function processLeadOutcome(leadId, companyId, outcome) {
    if (!leadId) return { error: "No Lead ID" };

    const leadRef = db.collection("leads").doc(leadId);
    const now = new Date();
    let lockUntil = new Date();
    let reason = "pool_recycle";

    // Logic: If hired, lock for 60 days. If rejected, cool off for 7 days.
    if (outcome === 'hired_elsewhere' || outcome === 'hired' || outcome === 'Approved') {
        lockUntil.setDate(now.getDate() + POOL_HIRED_LOCK_DAYS);
        reason = "hired";
    } else if (outcome === 'not_interested' || outcome === 'not_qualified' || outcome === 'Rejected') {
        lockUntil.setDate(now.getDate() + POOL_COOL_OFF_DAYS);
        reason = "rejected";
    } else {
        return { message: "No pool action needed" };
    }

    await leadRef.update({
        unavailableUntil: admin.firestore.Timestamp.fromDate(lockUntil),
        lastOutcome: outcome,
        lastOutcomeBy: companyId,
        poolStatus: reason
    });

    return { success: true, mode: reason, lockedUntil: lockUntil };
}

// --- 5. DRIVER INTEREST ---
async function confirmDriverInterest(leadId, companyIdOrSlug, recruiterId) {
    if (!leadId || !companyIdOrSlug) return { success: false, error: "Missing data" };

    let companyId = companyIdOrSlug;
    // Resolve Slug if needed
    const companyQuery = await db.collection("companies").where("appSlug", "==", companyIdOrSlug).limit(1).get();
    if (!companyQuery.empty) {
        companyId = companyQuery.docs[0].id;
    } else {
        const directDoc = await db.collection("companies").doc(companyIdOrSlug).get();
        if (!directDoc.exists) return { success: false, error: "Invalid Company Link" };
        companyId = companyIdOrSlug;
    }

    const leadRef = db.collection("leads").doc(leadId);
    const leadSnap = await leadRef.get();

    if (!leadSnap.exists) {
        return { success: false, error: "Lead not found in global pool." };
    }

    const leadData = leadSnap.data();
    const nowTs = admin.firestore.Timestamp.now();

    let recruiterName = "Assigned Recruiter";
    if (recruiterId) {
        try {
            const userSnap = await db.collection("users").doc(recruiterId).get();
            if (userSnap.exists) recruiterName = userSnap.data().name || recruiterName;
        } catch(e) { console.warn("Could not fetch recruiter name"); }
    }

    // Convert Lead to Application directly
    const appRef = db.collection("companies").doc(companyId).collection("applications").doc(leadId);
    const oldLeadRef = db.collection("companies").doc(companyId).collection("leads").doc(leadId);

    const appData = {
        ...leadData,
        status: "New Application", 
        source: "Driver Interest Link", 
        isPlatformLead: true,
        originalLeadId: leadId,
        assignedTo: recruiterId, 
        assignedToName: recruiterName,
        createdAt: nowTs,
        submittedAt: nowTs,
        updatedAt: nowTs
    };

    // Lock the driver in the pool so they aren't distributed elsewhere while applying
    const lockDate = new Date();
    lockDate.setDate(lockDate.getDate() + POOL_INTEREST_LOCK_DAYS);
    const lockTs = admin.firestore.Timestamp.fromDate(lockDate);

    const batch = db.batch();
    batch.set(appRef, appData, { merge: true });
    
    // Remove from "leads" subcollection if they were there
    const oldCheck = await oldLeadRef.get();
    if (oldCheck.exists) batch.delete(oldLeadRef);

    batch.update(leadRef, {
        unavailableUntil: lockTs,
        lastAssignedTo: companyId,
        poolStatus: "engaged_interest"
    });

    await batch.commit();

    return { success: true, message: "Application created and assigned." };
}

// --- 6. ANALYTICS ---
async function generateDailyAnalytics() {
    const todayStr = new Date().toISOString().split('T')[0];
    const analyticsRef = db.collection("analytics").doc(todayStr);

    const companiesCount = (await db.collection("companies").count().get()).data().count;
    const leadsCount = (await db.collection("leads").count().get()).data().count;

    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    const todayTs = admin.firestore.Timestamp.fromDate(todayStart);

    // Count calls made today
    const activitiesSnap = await db.collectionGroup("activities")
        .where("timestamp", ">=", todayTs)
        .get();

    let calls = 0;
    const companyActivity = {};

    activitiesSnap.forEach(doc => {
        const a = doc.data();
        if (a.type === 'call') calls++;

        if (a.companyId) {
            if (!companyActivity[a.companyId]) companyActivity[a.companyId] = { calls: 0, actions: 0 };
            if (a.type === 'call') companyActivity[a.companyId].calls++;
            companyActivity[a.companyId].actions++;
        }
    });

    await analyticsRef.set({
        date: todayStr,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        metrics: {
            totalCompanies: companiesCount,
            totalLeadsInPool: leadsCount,
            totalCallsMade: calls,
            totalActions: activitiesSnap.size
        },
        byCompany: companyActivity
    }, { merge: true });

    return { success: true, date: todayStr, calls };
}

// --- HELPERS ---
async function harvestNotesBeforeDelete(docSnap, data) {
    try {
        const notesSnap = await docSnap.ref.collection("internal_notes").get();
        const notesToShare = [];
        notesSnap.forEach(noteDoc => {
            const n = noteDoc.data();
            notesToShare.push({ text: n.text, date: n.createdAt, source: "Previous Recruiter" });
        });

        const originalId = data.originalLeadId || docSnap.id;
        if (originalId) {
            const rootRef = db.collection("leads").doc(originalId);
            const updatePayload = {};
            if (notesToShare.length > 0) {
                updatePayload.sharedHistory = admin.firestore.FieldValue.arrayUnion(...notesToShare);
            }
            if (Object.keys(updatePayload).length > 0) {
                await rootRef.update(updatePayload).catch(() => {});
            }
        }
    } catch (e) { console.warn(`Harvest failed for ${docSnap.id}`, e); }
}

async function runCleanup() {
    const leadsRef = db.collection("leads");
    const snapshot = await leadsRef.get();
    let batch = db.batch();
    let batchSize = 0; 
    let count = 0;
    for (const doc of snapshot.docs) {
        const data = doc.data();
        // Delete junk leads with no contact info
        if (!data.phone && !data.email && data.firstName === 'Unknown') {
            batch.delete(doc.ref);
            batchSize++;
            count++;
        }
        if (batchSize >= 400) { await batch.commit(); batch = db.batch(); batchSize = 0; }
    }
    if (batchSize > 0) await batch.commit();
    return { success: true, deleted: count };
}

// Stub for migration
async function runMigration() { return {success:true}; }

module.exports = { 
    runLeadDistribution, 
    runMigration, 
    runCleanup,
    processLeadOutcome, 
    confirmDriverInterest,
    generateDailyAnalytics 
};
