// functions/leadDistribution.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { 
    runLeadDistribution, 
    populateLeadsFromDrivers, // <--- IMPORTED
    runCleanup,
    processLeadOutcome,
    generateDailyAnalytics,
    confirmDriverInterest
} = require("./leadLogic");

const RUNTIME_OPTS = {
    timeoutSeconds: 540,
    memory: '512MiB', // Increased Memory for Heavy Migration
    maxInstances: 1,
    concurrency: 1,
    cors: true 
};

// --- 1. SCHEDULED TASK ---
exports.runLeadDistribution = onSchedule({
    schedule: "0 0 * * *", 
    timeZone: "America/New_York",
    timeoutSeconds: 540,
    memory: '512MiB'
}, async (event) => {
    try {
        const result = await runLeadDistribution(false);
        console.log("Scheduled result:", result);
    } catch (error) {
        console.error("Scheduled failed:", error);
    }
});

// --- 2. MANUAL BUTTON ---
exports.distributeDailyLeads = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin only.");
    }
    try {
        const result = await runLeadDistribution(false); 
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
        const result = await processLeadOutcome(leadId, companyId, outcome);
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// --- 5. ANALYTICS ---
exports.aggregateAnalytics = onSchedule({
    schedule: "55 23 * * *",
    timeZone: "America/New_York",
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
        const result = await confirmDriverInterest(leadId, companyId, recruiterId);
        return result;
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }
});

// --- 7. MIGRATION TOOL (Fix Data Button) ---
// This now uses the REAL logic
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

// Alias
exports.distributeDailyLeadsScheduled = exports.runLeadDistribution;