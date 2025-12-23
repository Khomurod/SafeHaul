const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");

// --- HELPER: Lazy Database Connection ---
let dbInstance = null;
let adminInstance = null;

function getServices() {
    if (!dbInstance) {
        const admin = require("firebase-admin");
        const { getFirestore } = require("firebase-admin/firestore");

        if (!admin.apps.length) {
            admin.initializeApp();
        }

        dbInstance = getFirestore();
        dbInstance.settings({ ignoreUndefinedProperties: true });
        adminInstance = admin;
    }
    return { db: dbInstance, admin: adminInstance };
}

// --- HELPER: Recursive Delete ---
async function deleteCollection(db, collectionPath, batchSize) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(db, query, resolve) {
  const snapshot = await query.get();
  if (snapshot.size === 0) {
    resolve();
    return;
  }
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  process.nextTick(() => deleteQueryBatch(db, query, resolve));
}

// --- FEATURE 1: GET COMPANY PROFILE (CORS ENABLED) ---
exports.getCompanyProfile = onCall({ 
    cors: true, // <--- THIS IS THE CRITICAL FIX
    maxInstances: 10 
}, async (request) => {
    const { companyId } = request.data;
    
    if (!companyId) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "companyId" argument.');
    }

    const { db } = getServices();

    try {
        const docRef = db.collection("companies").doc(companyId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            return docSnap.data();
        } else {
            throw new HttpsError('not-found', 'No company profile found for this ID.');
        }
    } catch (error) {
        console.error("Error fetching company profile:", error);
        throw new HttpsError('internal', 'Unable to fetch company profile details.');
    }
});

// --- FEATURE 2: DAILY LEAD DISTRIBUTION (SCHEDULED) ---
exports.runLeadDistribution = onSchedule({
    schedule: "every 24 hours",
    region: "us-central1",
    timeoutSeconds: 540,
    memory: '512MiB'
}, async (event) => {
    console.log("--- STARTING DAILY LEAD DISTRIBUTION ---");
    const { db, admin } = getServices(); 

    try {
        const companiesSnap = await db.collection('companies').where('dailyQuota', '>', 0).get();
        if (companiesSnap.empty) return;

        const leadsSnap = await db.collection('leads').where('status', '==', 'active').get();
        if (leadsSnap.empty) return;

        let allLeads = leadsSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), ref: doc.ref }));
        const BATCH_LIMIT = 400;

        for (const companyDoc of companiesSnap.docs) {
            const companyId = companyDoc.id;
            const companyData = companyDoc.data();
            const quota = parseInt(companyData.dailyQuota) || 0;

            await deleteCollection(db, `companies/${companyId}/leads`, BATCH_LIMIT);

            let scoredLeads = allLeads.map(lead => {
                const history = lead.distributionHistory || {};
                const lastSeenTimestamp = history[companyId] ? history[companyId].toDate().getTime() : 0;
                return { ...lead, _sortLastSeen: lastSeenTimestamp, _sortRandom: Math.random() };
            });

            scoredLeads.sort((a, b) => {
                if (a._sortLastSeen !== b._sortLastSeen) return a._sortLastSeen - b._sortLastSeen;
                return a._sortRandom - b._sortRandom;
            });

            const selectedLeads = scoredLeads.slice(0, quota);
            let batch = db.batch();
            let opCount = 0;
            const timestamp = admin.firestore.Timestamp.now();

            for (const lead of selectedLeads) {
                const companyLeadRef = db.collection('companies').doc(companyId).collection('leads').doc(lead.id);
                const leadForCompany = {
                    ...lead, distributedAt: timestamp, isPlatformLead: true,
                    _sortLastSeen: admin.firestore.FieldValue.delete(),
                    _sortRandom: admin.firestore.FieldValue.delete()
                };
                batch.set(companyLeadRef, leadForCompany);
                opCount++;
                batch.update(lead.ref, { [`distributionHistory.${companyId}`]: timestamp });
                opCount++;
                if (opCount >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); opCount = 0; }
            }
            if (opCount > 0) await batch.commit();
        }
    } catch (error) {
        console.error("Distribution Failed:", error);
    }
});

// --- FEATURE 3: DELETE COMPANY (Admin Only) ---
exports.deleteCompany = onCall({ cors: true }, async (request) => {
    // Basic guard: Check if user is authenticated
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }
    
    // Check for super admin status
    const roles = request.auth.token.roles || {};
    const isSuperAdmin = roles.globalRole === "super_admin";
    
    if (!isSuperAdmin) {
        throw new HttpsError('permission-denied', 'Only Super Admins can delete companies.');
    }

    const { companyId } = request.data;
    if (!companyId) throw new HttpsError('invalid-argument', 'Missing companyId.');

    const { db } = getServices();

    try {
        // 1. Delete Subcollections (Applications, Leads) - Limit to 500 to prevent timeout
        await deleteCollection(db, `companies/${companyId}/applications`, 500);
        await deleteCollection(db, `companies/${companyId}/leads`, 500);

        // 2. Delete Main Document
        await db.collection('companies').doc(companyId).delete();

        // 3. Remove Memberships linked to this company
        const memSnap = await db.collection('memberships').where('companyId', '==', companyId).get();
        const batch = db.batch();
        memSnap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        return { success: true, message: `Company ${companyId} deleted.` };
    } catch (error) {
        console.error("Delete Company Error:", error);
        throw new HttpsError('internal', error.message);
    }
});

// --- FEATURE 4: MOVE APPLICATION (Company Admin) ---
exports.moveApplication = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    
    const { companyId, applicationId, newStatus } = request.data;
    const { db } = getServices();

    try {
        await db.collection('companies').doc(companyId)
                .collection('applications').doc(applicationId)
                .update({ status: newStatus });
        return { success: true };
    } catch (e) {
        throw new HttpsError('internal', e.message);
    }
});

// --- FEATURE 5: SEND AUTOMATED EMAIL (Stub) ---
exports.sendAutomatedEmail = onCall({ cors: true }, async (request) => {
    // This is a stub. In production, you would connect to SendGrid/Mailgun here.
    return { success: true, message: "Email simulation successful." };
});

// --- FEATURE 6: GET PERFORMANCE HISTORY (Stub) ---
exports.getTeamPerformanceHistory = onCall({ cors: true }, async (request) => {
    return { data: [
        { date: '2023-10-01', applications: 12, hires: 2 },
        { date: '2023-10-02', applications: 15, hires: 3 },
        { date: '2023-10-03', applications: 8, hires: 1 },
    ]};
});

// --- FEATURE 7: MANUAL MIGRATION TOOL (CALLABLE) ---
const migrationLogic = onCall({
    cors: true,             
    region: "us-central1",  
    maxInstances: 10
}, async (request) => {

    // 1. PING MODE (No DB access, just network check)
    if (request.data?.mode === 'ping') {
        return { success: true, message: "Pong! Network OK." };
    }

    // 2. MIGRATION LOGIC
    try {
        const { db } = getServices(); // Connect NOW

        const companiesRef = db.collection('companies');
        const snapshot = await companiesRef.get();
        let batch = db.batch();
        let count = 0;
        let totalUpdated = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            if (data.dailyQuota === undefined || data.dailyQuota === null) {
                batch.update(doc.ref, { dailyQuota: 50 });
                count++;
                totalUpdated++;
            }
            if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
        }
        if (count > 0) await batch.commit();

        return { success: true, message: `Migration complete. Updated ${totalUpdated} companies.` };

    } catch (error) {
        console.error("Migration Error:", error);
        return { success: false, error: error.message || "Unknown Internal Error" };
    }
});

exports.runMigration = migrationLogic;
exports.migrateDriversToLeads = migrationLogic;
