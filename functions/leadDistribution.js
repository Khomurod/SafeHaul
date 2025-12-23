// functions/leadDistribution.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { 
    runLeadDistribution, 
    runMigration, 
    runCleanup,
    processLeadOutcome,
    generateDailyAnalytics,
    confirmDriverInterest
} = require("./leadLogic");

// --- FIXED: Added cors: true ---
const RUNTIME_OPTS = {
    timeoutSeconds: 540,
    memory: '256MiB',
    maxInstances: 1,
    concurrency: 1,
    cors: true // <--- CRITICAL FIX FOR CORS ERROR
};

// --- EXPORT 1: Manual Distribution (Force Rotate) ---
exports.distributeDailyLeads = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin only.");
    }
    try {
        const result = await runLeadDistribution(true); 
        return result;
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }
});

// --- EXPORT 2: Scheduled Distribution (Standard Rotate) ---
exports.distributeDailyLeadsScheduled = onSchedule({
    schedule: "0 0 * * *", 
    timeZone: "America/New_York",
    timeoutSeconds: 540,
    memory: '256MiB'
}, async (event) => {
    try {
        const result = await runLeadDistribution(false);
        console.log("Scheduled result:", result);
    } catch (error) {
        console.error("Scheduled failed:", error);
    }
});

// --- EXPORT 3: Cleanup Tool ---
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

// --- EXPORT 4: Lead Outcome Handler ---
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
        console.error("Outcome Error:", error);
        return { success: false, error: error.message };
    }
});

// --- EXPORT 5: Analytics Aggregator (Scheduled) ---
exports.aggregateAnalytics = onSchedule({
    schedule: "55 23 * * *",
    timeZone: "America/New_York",
    timeoutSeconds: 540,
    memory: '256MiB'
}, async (event) => {
    try {
        const result = await generateDailyAnalytics();
        console.log("Analytics result:", result);
    } catch (error) {
        console.error("Analytics failed:", error);
    }
});

// --- EXPORT 6: Confirm Driver Interest ---
exports.confirmDriverInterest = onCall(RUNTIME_OPTS, async (request) => {
    const { leadId, companyId, recruiterId } = request.data;
    try {
        const result = await confirmDriverInterest(leadId, companyId, recruiterId);
        return result;
    } catch (error) {
        console.error("Interest Error:", error);
        throw new HttpsError("internal", error.message);
    }
});

// Disabled Exports
exports.migrateDriversToLeads = onCall(RUNTIME_OPTS, async() => { return {message: "Disabled"} });