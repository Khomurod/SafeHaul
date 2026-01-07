// functions/leadDistribution.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { admin, db } = require("./firebaseAdmin"); // <--- Added admin/db imports
const {
    runLeadDistribution,
    populateLeadsFromDrivers,
    runCleanup,
    processLeadOutcome,
    generateDailyAnalytics,
    confirmDriverInterest
} = require("./leadLogic");

const RUNTIME_OPTS = {
    timeoutSeconds: 540,
    memory: '512MiB',
    maxInstances: 1,
    concurrency: 1,
    cors: true
};

// --- 1. PLANNING PHASE (6:00 AM Central Time) ---
exports.planLeadDistribution = onSchedule({
    schedule: "0 6 * * *",
    timeZone: "America/Chicago",
    timeoutSeconds: 540,
    memory: '512MiB'
}, async (event) => {
    try {
        console.log("Running scheduled daily PLANNING (6:00 AM CT)...");
        // For now, planning just identifies counts and marks pool leads. 
        // We can extend this to set a 'plannedFor' flag later.
        const result = await runLeadDistribution(false); // Run without rotation to 'prime' the engine
        console.log("Planning result:", result);
    } catch (error) {
        console.error("Planning failed:", error);
    }
});

// --- 2. EXECUTION PHASE (7:00 AM Central Time) ---
exports.runLeadDistribution = onSchedule({
    schedule: "0 7 * * *",
    timeZone: "America/Chicago",
    timeoutSeconds: 540,
    memory: '512MiB'
}, async (event) => {
    try {
        console.log("Running scheduled daily EXECUTION (7:00 AM CT)...");
        const result = await runLeadDistribution(true); // Force rotation
        console.log("Execution result:", result);
    } catch (error) {
        console.error("Execution failed:", error);
    }
});

// --- 2. MANUAL BUTTON (Force New Round) ---
exports.distributeDailyLeads = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin only.");
    }
    try {
        console.log("Super Admin forcing manual lead distribution round...");
        const result = await runLeadDistribution(true);
        return result;
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }
});

// --- 3. CLEANUP TOOL ---
exports.cleanupBadLeads = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin only.");
    }
    try {
        const result = await runCleanup();
        return result;
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }
});

// --- 4. LEAD OUTCOME HANDLER ---
exports.handleLeadOutcome = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
    const { leadId, companyId, outcome } = request.data;
    const userRole = request.auth.token.roles?.[companyId];
    const isSuper = request.auth.token.roles?.globalRole === 'super_admin';

    if (!isSuper && !userRole) {
        throw new HttpsError("permission-denied", "You do not have access to this company.");
    }

    try {
        const result = await processLeadOutcome(request.data);
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// --- 5. ANALYTICS ---
exports.aggregateAnalytics = onSchedule({
    schedule: "55 23 * * *",
    timeZone: "America/Chicago",
    timeoutSeconds: 540,
    memory: '256MiB'
}, async (event) => {
    try {
        await generateDailyAnalytics();
    } catch (error) {
        console.error("Analytics failed:", error);
    }
});

// --- 6. DRIVER INTEREST ---
exports.confirmDriverInterest = onCall(RUNTIME_OPTS, async (request) => {
    const { leadId, companyId, recruiterId } = request.data;
    try {
        const result = await confirmDriverInterest(request.data);
        return result;
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }
});

// --- 7. MIGRATION TOOL ---
exports.migrateDriversToLeads = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin only.");
    }
    try {
        const result = await populateLeadsFromDrivers();
        return result;
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }
});

// --- 8. LEAD SUPPLY & DEMAND ANALYZER (NEW) ---
exports.getLeadSupplyAnalytics = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin only.");
    }

    try {
        const now = admin.firestore.Timestamp.now();

        // 1. ANALYZE DEMAND (Company Quotas)
        const companiesSnap = await db.collection("companies").where("isActive", "==", true).get();
        let totalDailyDemand = 0;
        let activeCompanies = 0;

        companiesSnap.forEach(doc => {
            const d = doc.data();
            const quota = d.dailyLeadQuota || (d.planType === 'paid' ? 200 : 50);
            totalDailyDemand += quota;
            activeCompanies++;
        });

        // 2. ANALYZE SUPPLY (Global Pool)
        const totalGlobalSnap = await db.collection("leads").count().get();
        const totalGlobal = totalGlobalSnap.data().count;

        const unlockedSnap = await db.collection("leads")
            .where("unavailableUntil", "<=", now)
            .count().get();

        const freshSnap = await db.collection("leads")
            .where("unavailableUntil", "==", null)
            .count().get();

        const availableSupply = unlockedSnap.data().count + freshSnap.data().count;

        // 3. ANALYZE DISTRIBUTION (Subcollection Scan)
        const distributedSnap = await db.collectionGroup("leads")
            .where("isPlatformLead", "==", true)
            .count().get();

        const privateSnap = await db.collectionGroup("leads")
            .where("isPlatformLead", "==", false)
            .count().get();

        return {
            demand: {
                companiesCount: activeCompanies,
                totalDailyQuota: totalDailyDemand
            },
            supply: {
                totalInPool: totalGlobal,
                availableNow: availableSupply,
                locked: totalGlobal - availableSupply
            },
            distribution: {
                totalDistributedInCirculation: distributedSnap.data().count,
                totalPrivateUploads: privateSnap.data().count
            },
            health: {
                status: availableSupply >= totalDailyDemand ? 'surplus' : 'deficit',
                gap: availableSupply - totalDailyDemand
            }
        };

    } catch (error) {
        console.error("Analytics Error:", error);
        throw new HttpsError("internal", error.message);
    }
});

// Alias
exports.distributeDailyLeadsScheduled = exports.runLeadDistribution;