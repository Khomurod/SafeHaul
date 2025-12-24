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

const RUNTIME_OPTS = {
    timeoutSeconds: 540,
    memory: '256MiB',
    maxInstances: 1,
    concurrency: 1,
    cors: true 
};

// --- 1. SCHEDULED TASK (Every 24 Hours) ---
// This replaces the conflicting function in companyAdmin.js
exports.runLeadDistribution = onSchedule({
    schedule: "0 0 * * *", // Midnight EST
    timeZone: "America/New_York",
    timeoutSeconds: 540,
    memory: '512MiB'
}, async (event) => {
    console.log("--- STARTING SCHEDULED LEAD DISTRIBUTION ---");
    try {
        // Run standard distribution (Respecting 24h/7d locks)
        const result = await runLeadDistribution(false);
        console.log("Scheduled result:", result);
    } catch (error) {
        console.error("Scheduled failed:", error);
    }
});

// --- 2. MANUAL BUTTON (Force Rotate Option) ---
// Called by the "Distribute Leads" button in Super Admin
exports.distributeDailyLeads = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin only.");
    }
    try {
        // Pass true to force rotation if needed, or false for standard
        // For manual buttons, we usually imply 'Run Now', adhering to rules.
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
// Called when a recruiter marks a lead as Hired, Rejected, etc.
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

// --- 5. ANALYTICS (Scheduled) ---
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

// --- 6. DRIVER INTEREST LINK ---
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

// Alias for compatibility (can be removed if not used)
exports.distributeDailyLeadsScheduled = exports.runLeadDistribution;

// Disabled Exports
exports.migrateDriversToLeads = onCall(RUNTIME_OPTS, async() => { return {message: "Disabled"} });
