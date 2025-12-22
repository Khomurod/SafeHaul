const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
// REMOVED: Top-level require of firebaseAdmin to prevent cold-start crashes

// --- HELPER: Lazy Database Connection ---
// This ensures we only connect when the function actually runs, preventing global crashes
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

// --- FEATURE 1: DAILY LEAD DISTRIBUTION (SCHEDULED) ---
exports.runLeadDistribution = onSchedule({
    schedule: "every 24 hours",
    region: "us-central1",
    timeoutSeconds: 540,
    memory: '512MiB'
}, async (event) => {
    console.log("--- STARTING DAILY LEAD DISTRIBUTION ---");
    const { db, admin } = getServices(); // Connect NOW, not at top of file

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

// --- FEATURE 2: MANUAL MIGRATION TOOL (CALLABLE) ---
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
        // Return 200 OK with error to ensure CORS headers pass
        return { success: false, error: error.message || "Unknown Internal Error" };
    }
});

exports.runMigration = migrationLogic;
exports.migrateDriversToLeads = migrationLogic;