// functions/companyAdmin.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const firebase_tools = require('firebase-tools');

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

// --- FEATURE 1: GET COMPANY PROFILE ---
exports.getCompanyProfile = onCall({ 
    cors: true, 
    maxInstances: 10 
}, async (request) => {
    const { companyId } = request.data;
    if (!companyId) throw new HttpsError('invalid-argument', 'Missing companyId.');

    const { db } = getServices();
    try {
        const docRef = db.collection("companies").doc(companyId);
        const docSnap = await docRef.get();
        if (docSnap.exists) return docSnap.data();
        throw new HttpsError('not-found', 'No company profile found.');
    } catch (error) {
        console.error("Error fetching company profile:", error);
        throw new HttpsError('internal', 'Unable to fetch company profile.');
    }
});

// --- FEATURE 2: DELETE COMPANY (Admin Only - Refactored for Stability) ---
exports.deleteCompany = onCall({ 
    cors: true, 
    timeoutSeconds: 540, // Maximize timeout for deletion operations
    memory: '1GiB' 
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    // STRICTER AUTH: Use the custom claim we set in rules/auth logic
    const roles = request.auth.token.roles || {};
    const globalRole = request.auth.token.globalRole || roles.globalRole;
    const isSuperAdmin = globalRole === "super_admin";

    if (!isSuperAdmin) throw new HttpsError('permission-denied', 'Only Super Admins can delete companies.');

    const { companyId } = request.data;
    if (!companyId) throw new HttpsError('invalid-argument', 'Missing companyId.');

    const { db } = getServices();

    try {
        // 1. Recursive Delete using firebase-tools (Handles huge collections safely)
        console.log(`Starting recursive delete for company: ${companyId}`);

        await firebase_tools.firestore.delete(`companies/${companyId}`, {
            project: process.env.GCLOUD_PROJECT,
            recursive: true,
            yes: true,
            force: true
        });

        // 2. Clean up Memberships (These are outside the subcollection)
        const memSnap = await db.collection('memberships').where('companyId', '==', companyId).get();
        const batch = db.batch();
        memSnap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        console.log(`Successfully deleted company ${companyId}`);
        return { success: true, message: `Company ${companyId} deleted.` };
    } catch (error) {
        console.error("Delete Company Error:", error);
        throw new HttpsError('internal', `Delete failed: ${error.message}`);
    }
});

// --- FEATURE 3: MOVE APPLICATION ---
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

// --- FEATURE 4: SEND AUTOMATED EMAIL ---
exports.sendAutomatedEmail = onCall({ cors: true }, async (request) => {
    return { success: true, message: "Email simulation successful." };
});

// --- FEATURE 5: GET PERFORMANCE HISTORY ---
exports.getTeamPerformanceHistory = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const { companyId, startDate, endDate } = request.data;
    if (!companyId) throw new HttpsError('invalid-argument', 'Missing companyId.');

    const { db } = getServices();

    try {
        const start = new Date(startDate);
        const end = new Date(endDate);

        const activitiesQuery = db.collectionGroup('activities')
            .where('companyId', '==', companyId)
            .where('timestamp', '>=', start)
            .where('timestamp', '<=', end);

        const snapshot = await activitiesQuery.get();

        const statsByUser = {}; 

        snapshot.forEach(doc => {
            const data = doc.data();
            const userId = data.performedBy || 'unknown';
            const userName = data.performedByName || 'Unknown Recruiter';
            const outcome = data.outcome;

            if (!statsByUser[userId]) {
                statsByUser[userId] = {
                    id: userId, name: userName, dials: 0, connected: 0, 
                    callback: 0, notInt: 0, notQual: 0, vm: 0
                };
            }

            statsByUser[userId].dials++;

            switch (outcome) {
                case 'interested': 
                case 'callback': 
                    statsByUser[userId].callback += (outcome === 'callback' ? 1 : 0);
                    statsByUser[userId].connected++;
                    break;
                case 'not_interested':
                case 'hired_elsewhere': 
                    statsByUser[userId].notInt++; 
                    break;
                case 'not_qualified':
                case 'wrong_number': 
                    statsByUser[userId].notQual++; 
                    break;
                case 'voicemail':
                case 'no_answer': 
                    statsByUser[userId].vm++; 
                    break;
                default: 
                    if (data.isContact) statsByUser[userId].connected++;
                    break;
            }
        });

        return { 
            success: true, 
            data: Object.values(statsByUser) 
        };

    } catch (error) {
        console.error("Performance Report Error:", error);
        throw new HttpsError('internal', error.message);
    }
});

// --- FEATURE 6: MANUAL MIGRATION TOOL ---
const migrationLogic = onCall({
    cors: true, region: "us-central1", maxInstances: 10
}, async (request) => {
    if (request.data?.mode === 'ping') return { success: true, message: "Pong!" };
    try {
        const { db } = getServices();
        const companiesRef = db.collection('companies');
        // Use a cursor or limit in production for safer migration, 
        // but for now we keep the structure while handling errors gracefully.
        const snapshot = await companiesRef.get();
        let batch = db.batch();
        let count = 0;
        let totalUpdated = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            // Idempotent check
            if (data.dailyQuota === undefined || data.dailyQuota === null) {
                batch.update(doc.ref, { dailyQuota: 50 });
                count++;
                totalUpdated++;
            }
            if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
        }
        if (count > 0) await batch.commit();
        return { success: true, message: `Updated ${totalUpdated} companies.` };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

exports.runMigration = migrationLogic;
exports.migrateDriversToLeads = migrationLogic;