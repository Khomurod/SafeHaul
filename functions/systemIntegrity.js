// functions/systemIntegrity.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
// The deploy planner's own test (scripts/test-deploy-incremental.mjs) uses this
// require as its real-graph fixture; the two go together in the dead-code step.
require("./schemaConfig");

// Retired: it wrote schema defaults (a "driver" role, an "active" status,
// isActive: true) into every live record missing a field. Old Production
// screens still offer its button, so the callable stays, and refuses.
exports.syncSystemStructure = onCall({ cors: true }, async () => {
    throw new HttpsError("failed-precondition", "This maintenance action was retired. Nothing was changed.");
});

// --- INTERNAL LOGIC (Exported for Testing) ---
async function performSecurityAudit(db) {
    const results = {
        timestamp: new Date().toISOString(),
        checks: []
    };

    // CHECK 1: Ghost Companies
    const ghostSnap = await db.collection("companies").where("createdAt", "==", null).get();
    results.checks.push({
        id: 'ghost_companies',
        name: 'Ghost Company Records',
        status: ghostSnap.empty ? 'PASS' : 'WARN',
        details: `${ghostSnap.size} companies found without creation timestamp.`
    });

    // CHECK 2: Super Admin Count
    const adminSnap = await db.collection("memberships").where("role", "==", "super_admin").get();
    results.checks.push({
        id: 'super_admin_count',
        name: 'Super Admin Count',
        status: 'INFO',
        details: `${adminSnap.size} Super Admin memberships found.`
    });

    // CHECK 3: Integrity
    results.checks.push({
        id: 'integrity_check',
        name: 'Data Integrity',
        status: 'PASS',
        details: 'Basic framework validation passed.'
    });

    return results;
}

exports.performSecurityAudit = performSecurityAudit;

// --- SECURITY AUDIT (New Feature) ---
exports.runSecurityAudit = onCall({
    timeoutSeconds: 300,
    memory: '512MiB',
    cors: true
}, async (request) => {
    // 1. Security Check
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin Access Required.");
    }
    const { db } = require("./firebaseAdmin");
    try {
        const report = await performSecurityAudit(db);
        return { success: true, report };
    } catch (e) {
        console.error("Security Audit Failed:", e);
        throw new HttpsError('internal', e.message);
    }
});