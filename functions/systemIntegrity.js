// functions/systemIntegrity.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("./firebaseAdmin");
const { SCHEMA_DEFINITIONS } = require("./schemaConfig");

// RUNTIME OPTIONS (Long timeout for database repair)
const RUNTIME_OPTS = {
    timeoutSeconds: 540, 
    memory: '512MiB',
    cors: true
};

// --- HELPER: REPAIR SINGLE BATCH ---
async function repairCollection(collectionName, schemaKey, isSubcollection = false, parentId = null) {
    const config = SCHEMA_DEFINITIONS[schemaKey];
    if (!config) return { scanned: 0, fixed: 0 };

    let queryRef;
    if (isSubcollection && parentId) {
        queryRef = db.collection("companies").doc(parentId).collection(collectionName);
    } else {
        queryRef = db.collection(collectionName);
    }

    // Snapshot all docs (Warning: heavy read for large DBs)
    const snapshot = await queryRef.get();
    let batch = db.batch();
    let batchSize = 0;
    let fixedCount = 0;
    let scannedCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const updates = {};
        let needsUpdate = false;
        scannedCount++;

        // 1. Check Missing Fields
        for (const [field, defaultValue] of Object.entries(config.fields)) {
            if (data[field] === undefined) {
                // Field is missing, assign default
                if (defaultValue === "TIMESTAMP") {
                    updates[field] = admin.firestore.FieldValue.serverTimestamp();
                } else {
                    updates[field] = defaultValue;
                }
                needsUpdate = true;
            }
        }

        // 2. Queue Update
        if (needsUpdate) {
            batch.update(doc.ref, updates);
            batchSize++;
            fixedCount++;
        }

        // 3. Commit Batch if full
        if (batchSize >= 400) {
            await batch.commit();
            batch = db.batch();
            batchSize = 0;
        }
    }

    // Commit remaining
    if (batchSize > 0) await batch.commit();

    return { scanned: scannedCount, fixed: fixedCount };
}

// --- MAIN EXPORTED FUNCTION ---
exports.syncSystemStructure = onCall(RUNTIME_OPTS, async (request) => {
    // 1. Security Check
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin Access Required.");
    }

    console.log("Starting System Integrity Sync...");
    const results = { companies: 0, leads: 0, users: 0, fixes: 0 };

    try {
        // A. REPAIR COMPANIES
        const compStats = await repairCollection("companies", "company");
        results.companies = compStats.scanned;
        results.fixes += compStats.fixed;

        // B. REPAIR LEADS
        const leadStats = await repairCollection("leads", "lead");
        results.leads = leadStats.scanned;
        results.fixes += leadStats.fixed;

        // C. REPAIR USERS
        const userStats = await repairCollection("users", "user");
        results.users = userStats.scanned;
        results.fixes += userStats.fixed;

        // D. REPAIR SUBCOLLECTIONS (Applications)
        // Note: For deep repairs, we iterate companies again. 
        // In a huge app, this would be a separate "Deep Clean" task.
        const companiesSnap = await db.collection("companies").get();
        for (const comp of companiesSnap.docs) {
            const appStats = await repairCollection("applications", "application", true, comp.id);
            results.fixes += appStats.fixed;
        }

        return { 
            success: true, 
            message: `System Logic Repaired. Scanned ${results.companies + results.leads} docs. Applied ${results.fixes} fixes.`,
            stats: results
        };

    } catch (error) {
        console.error("Integrity Sync Failed:", error);
        throw new HttpsError("internal", error.message);
    }
});