// hr portal/functions/leadDistribution.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { 
    runLeadDistribution, 
    runMigration, 
    runCleanup,
    processLeadOutcome,
    generateDailyAnalytics,
    confirmDriverInterest // <-- Import the new function
} = require("./leadLogic");

const RUNTIME_OPTS = {
    timeoutSeconds: 540,
    memory: '256MiB',
    maxInstances: 1,
    concurrency: 1
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
// Runs at midnight EST
exports.distributeDailyLeadsScheduled = onSchedule({
    schedule: "0 0 * * *", 
    timeZone: "America/New_York",
    ...RUNTIME_OPTS 
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

// --- EXPORT 4: Lead Outcome Handler (Pool Logic) ---
exports.handleLeadOutcome = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
    
    const { leadId, companyId, outcome } = request.data;
    
    // Security Check: User must belong to the company they are reporting for
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
        // We return success: false instead of throwing to prevent frontend crashes on background logic
        return { success: false, error: error.message };
    }
});

// --- EXPORT 5: Analytics Aggregator (Scheduled) ---
// Runs at 11:55 PM EST to capture the day's activity before midnight reset
exports.aggregateAnalytics = onSchedule({
    schedule: "55 23 * * *",
    timeZone: "America/New_York",
    ...RUNTIME_OPTS
}, async (event) => {
    try {
        const result = await generateDailyAnalytics();
        console.log("Analytics result:", result);
    } catch (error) {
        console.error("Analytics failed:", error);
    }
});

// --- EXPORT 6: Confirm Driver Interest (New) ---
exports.confirmDriverInterest = onCall(RUNTIME_OPTS, async (request) => {
    // This endpoint is public (no auth check) because drivers click it from SMS/Email links.
    // Security is handled by validating the Lead ID existence and Company mapping.
    
    const { leadId, companyId, recruiterId } = request.data;
    
    try {
        const result = await confirmDriverInterest(leadId, companyId, recruiterId);
        return result;
    } catch (error) {
        console.error("Interest Error:", error);
        throw new HttpsError("internal", error.message);
    }
});

// Disable Migration export to prevent accidents
exports.migrateDriversToLeads = onCall(RUNTIME_OPTS, async() => { return {message: "Disabled"} });