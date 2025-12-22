// hr portal/functions/leadLogic.js

const { admin, db } = require("./firebaseAdmin");

// --- CONSTANTS ---
const EXPIRY_SHORT_MS = 24 * 60 * 60 * 1000; // 24 Hours (Company view)
const EXPIRY_LONG_MS = 7 * 24 * 60 * 60 * 1000; // 7 Days (Company view)

// POOL RULES
const POOL_COOL_OFF_DAYS = 7;
const POOL_INTEREST_LOCK_DAYS = 7; // Driver clicked "Yes" -> Lock for 7 days
const POOL_HIRED_LOCK_DAYS = 60; // Hired/Approved -> Lock for 2 months (60 days)

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

function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

// --- 1. LEAD DISTRIBUTION ORCHESTRATOR ---
async function runLeadDistribution(forceRotate = false) {
    console.log(`Starting Lead Distribution Engine (Force: ${forceRotate})...`);
    const companiesSnap = await db.collection("companies").get();
    const allCompanyDocs = companiesSnap.docs;
    const allCompanyIds = allCompanyDocs.map(doc => doc.id);

    const distributionDetails = [];
    const now = new Date();
    const nowTs = admin.firestore.Timestamp.now();

    const assignedLeadIds = new Set(); 

    const companyChunks = chunkArray(allCompanyDocs, 5);
    for (const chunk of companyChunks) {
        const results = await Promise.all(chunk.map(async (companyDoc) => {
            const companyId = companyDoc.id;
            const companyData = companyDoc.data();
            const plan = companyData.planType || 'free';
            const LIMIT = plan === 'paid' ? 200 : 50;

            // A. CLEANUP
            const activeCount = await processCompanyCleanup(companyId, now, forceRotate);

            // B. REPLENISH
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
            return msg;
        }));

        distributionDetails.push(...results);
    }

    return { success: true, message: "Distribution Complete", details: distributionDetails };
}

// --- 2. CLEANUP LOGIC ---
async function processCompanyCleanup(companyId, now, forceRotate) {
    const companyLeadsRef = db.collection("companies").doc(companyId).collection("leads");
    const currentLeadsSnap = await companyLeadsRef.where("isPlatformLead", "==", true).get();

    let batch = db.batch();
    let opCount = 0;
    let activeCount = 0;

    for (const docSnap of currentLeadsSnap.docs) {
        const data = docSnap.data();
        let shouldDelete = false;
        const status = data.status || "New Lead";

        // Extended status check
        const isEngaged = ENGAGED_STATUSES.includes(status) && status !== "New Lead" && status !== "Attempted";

        if (forceRotate && !isEngaged) {
            shouldDelete = true;
        } else {
            if (!data.distributedAt) {
                shouldDelete = true;
            } else {
                const distributedTime = data.distributedAt.toDate().getTime();
                const age = now.getTime() - distributedTime;

                if (age > EXPIRY_LONG_MS) {
                    if (!["Hired", "Offer Accepted", "Approved"].includes(status)) shouldDelete = true;
                } else if (age > EXPIRY_SHORT_MS) {
                    if (!isEngaged) shouldDelete = true;
                }
            }
        }

        if (shouldDelete) {
            await harvestNotesBeforeDelete(docSnap, data);

            // Release lock on global lead if not specially locked (hired)
            if (data.originalLeadId) {
                 const leadRef = db.collection("leads").doc(data.originalLeadId);
                 const leadDoc = await leadRef.get();

                 if (leadDoc.exists) {
                     const currentUnavailable = leadDoc.data().unavailableUntil;
                     // Only reset if it's not locked far in the future (Hired/Interest)
                     if (!currentUnavailable || currentUnavailable.toDate() < now) {
                         // It's free
                     } else {
                         // Keep lock.
                     }
                 }
            }
            batch.delete(docSnap.ref);
        } else {
            activeCount++;
        }

        opCount++;
        if (opCount >= 400) { await batch.commit(); batch = db.batch(); opCount = 0; }
    }

    if (opCount > 0) await batch.commit();
    return activeCount;
}

// --- 3. REPLENISH LOGIC ---
async function processCompanyReplenishment(companyId, needed, nowTs, assignedLeadIds, allCompanyIds) {
    const companyLeadsRef = db.collection("companies").doc(companyId).collection("leads");

    // Fetch pool: leads where unavailableUntil is NULL or in the PAST
    const poolQuery = db.collection("leads")
        .where("unavailableUntil", "<=", nowTs) // Using Timestamp for comparison
        .orderBy("unavailableUntil", "asc") // Required for inequality filter
        .limit((needed * 5) + assignedLeadIds.size);

    let leadDocs = [];
    try {
        const poolSnap = await poolQuery.get();
        leadDocs = poolSnap.docs;

        if (leadDocs.length < needed) {
             const nullQuery = db.collection("leads").where("unavailableUntil", "==", null).limit(needed * 2);
             const nullSnap = await nullQuery.get();
             leadDocs = [...leadDocs, ...nullSnap.docs];
        }
    } catch (e) {
        console.warn("Pool query warning:", e);
        // Fallback: Just get latest
        const backupSnap = await db.collection("leads").orderBy("createdAt", "desc").limit(needed * 5).get();
        leadDocs = backupSnap.docs;
    }

    leadDocs = shuffleArray(leadDocs); // Randomize

    let batch = db.batch();
    let opCount = 0;
    let addedCount = 0;

    for (const leadDoc of leadDocs) {
        if (addedCount >= needed) break;
        if (assignedLeadIds.has(leadDoc.id)) continue;

        const existsCheck = await companyLeadsRef.doc(leadDoc.id).get();
        if (existsCheck.exists) continue;

        const rawData = leadDoc.data();

        // Fairness / Cycle check
        let visited = rawData.visitedCompanyIds || [];
        if (visited.includes(companyId)) continue;
        if (visited.length >= Math.max(1, allCompanyIds.length - 1)) visited = [];

        // Data Prep
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

        // Write to Company
        batch.set(companyLeadsRef.doc(leadDoc.id), distData);

        // Lock Global Lead (24 hours default for distribution)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        db.collection("leads").doc(leadDoc.id).update({ 
            unavailableUntil: admin.firestore.Timestamp.fromDate(tomorrow),
            lastAssignedTo: companyId,
            visitedCompanyIds: [...visited, companyId]
        });

        assignedLeadIds.add(leadDoc.id);
        addedCount++;
        opCount++;

        if (opCount >= 400) { await batch.commit(); batch = db.batch(); opCount = 0; }
    }

    if (opCount > 0) await batch.commit();
    return addedCount;
}

// --- 4. OUTCOME HANDLER (RECRUITER MANUAL) ---
async function processLeadOutcome(leadId, companyId, outcome) {
    if (!leadId) return { error: "No Lead ID" };

    const leadRef = db.collection("leads").doc(leadId);
    const now = new Date();
    let lockUntil = new Date();
    let reason = "pool_recycle";

    // Handle "Approved" or "Hired" -> 2 Month Lock
    if (outcome === 'hired_elsewhere' || outcome === 'hired' || outcome === 'Approved') {
        lockUntil.setDate(now.getDate() + POOL_HIRED_LOCK_DAYS);
        reason = "hired";
    } else if (outcome === 'not_interested' || outcome === 'not_qualified' || outcome === 'Rejected') {
        // Lock for 7 Days (Cool off)
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

// --- 5. DRIVER INTEREST HANDLER (DRIVER CLICKED LINK) ---
async function confirmDriverInterest(leadId, companyIdOrSlug, recruiterId) {
    // 1. Validation
    if (!leadId || !companyIdOrSlug) return { success: false, error: "Missing data" };

    // --- LOOKUP COMPANY ID IF SLUG IS PASSED ---
    let companyId = companyIdOrSlug;

    // Check if it looks like a slug by querying
    const companyQuery = await db.collection("companies").where("appSlug", "==", companyIdOrSlug).limit(1).get();
    if (!companyQuery.empty) {
        companyId = companyQuery.docs[0].id;
    } else {
        // If not found by slug, maybe it is a direct ID? Check existence.
        // check existence
        const directDoc = await db.collection("companies").doc(companyIdOrSlug).get();
        if (!directDoc.exists) return { success: false, error: "Invalid Company Link" };
        companyId = companyIdOrSlug;
    }
    // -------------------------------------------

    const leadRef = db.collection("leads").doc(leadId);
    const leadSnap = await leadRef.get();

    if (!leadSnap.exists) {
        return { success: false, error: "Lead not found in global pool." };
    }

    const leadData = leadSnap.data();
    const nowTs = admin.firestore.Timestamp.now();

    // 2. Determine Recruiter Name (if provided)
    let recruiterName = "Assigned Recruiter";
    if (recruiterId) {
        try {
            const userSnap = await db.collection("users").doc(recruiterId).get();
            if (userSnap.exists) recruiterName = userSnap.data().name || recruiterName;
        } catch(e) { console.warn("Could not fetch recruiter name"); }
    }

    // 3. Prepare Application Data
    // We create this directly in 'applications' collection
    const appRef = db.collection("companies").doc(companyId).collection("applications").doc(leadId);

    // We clean up 'leads' entry for this company if it exists (so it doesn't show up in two places)
    const oldLeadRef = db.collection("companies").doc(companyId).collection("leads").doc(leadId);

    const appData = {
        ...leadData,
        status: "New Application", // Explicit status for Interest
        source: "Driver Interest Link", // Mark source
        isPlatformLead: true,
        originalLeadId: leadId,
        assignedTo: recruiterId, // Assign to specific recruiter
        assignedToName: recruiterName,
        createdAt: nowTs, // Reset date so it appears at top
        submittedAt: nowTs,
        updatedAt: nowTs
    };

    // 4. Calculate 7-Day Exclusive Lock
    const lockDate = new Date();
    lockDate.setDate(lockDate.getDate() + POOL_INTEREST_LOCK_DAYS);
    const lockTs = admin.firestore.Timestamp.fromDate(lockDate);

    // 5. Execute Batch
    const batch = db.batch();
    batch.set(appRef, appData, { merge: true }); // Create Application
    batch.delete(oldLeadRef); // Remove from Leads list

    // Lock Global Lead
    batch.update(leadRef, {
        unavailableUntil: lockTs,
        lastAssignedTo: companyId,
        poolStatus: "engaged_interest"
    });

    await batch.commit();

    return { success: true, message: "Application created and assigned." };
}

// --- 6. ANALYTICS AGGREGATOR ---
async function generateDailyAnalytics() {
    const todayStr = new Date().toISOString().split('T')[0];
    const analyticsRef = db.collection("analytics").doc(todayStr);

    // Snapshot Counts
    const companiesCount = (await db.collection("companies").count().get()).data().count;
    const leadsCount = (await db.collection("leads").count().get()).data().count;

    // Activity Aggregation
    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    const todayTs = admin.firestore.Timestamp.fromDate(todayStart);

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
    let count = 0;
    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (!data.phone && !data.email && data.firstName === 'Unknown') {
            batch.delete(doc.ref);
            count++;
        }
        if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
    }
    if (count > 0) await batch.commit();
    return { success: true, deleted: count };
}

async function runMigration() { return {success:true}; }

module.exports = { 
    runLeadDistribution, 
    runMigration, 
    runCleanup,
    processLeadOutcome, 
    confirmDriverInterest, // <-- EXPORTED NEW FUNCTION
    generateDailyAnalytics 
};