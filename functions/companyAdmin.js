// functions/companyAdmin.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
// const firebase_tools = require('firebase-tools'); // <--- MOVED INSIDE FUNCTION

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
    // SECURITY: Strict Auth Check
    if (!request.auth) {
        console.warn("[getCompanyProfile] Unauthenticated request attempted.");
        throw new HttpsError('unauthenticated', 'Login required.');
    }

    const { companyId } = request.data;
    if (!companyId) {
        console.warn("[getCompanyProfile] Request missing companyId.");
        throw new HttpsError('invalid-argument', 'Missing companyId.');
    }

    const { db } = getServices();
    try {
        console.log(`[getCompanyProfile] Fetching profile for ID: ${companyId} (Requested by: ${request.auth.uid})`);

        const docRef = db.collection("companies").doc(companyId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            console.log(`[getCompanyProfile] Successfully found profile for: ${companyId}`);
            const data = docSnap.data();

            // SECURITY: Sanitize sensitive fields (SMTP Passwords)
            if (data.emailSettings && data.emailSettings.smtpPass) {
                data.emailSettings.smtpPass = '********'; // Masked
            }

            return data;
        }

        console.warn(`[getCompanyProfile] No company found with ID: ${companyId}`);
        throw new HttpsError('not-found', `No company profile found for ID: ${companyId}`);
    } catch (error) {
        // Log the full error internally
        console.error(`[getCompanyProfile] Critical error for company ${companyId}:`, error);

        // Return a cleaner error to the client
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', `Database error: ${error.message}`);
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

    const { db, admin } = getServices();
    const storage = admin.storage();

    // LAZY LOAD HEAVY MODULE
    const firebase_tools = require('firebase-tools');

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

        // 3. Clean up Storage (Bucket Cleanup)
        const bucket = storage.bucket();
        const prefixes = [
            `secure_documents/${companyId}/`,
            `company_assets/${companyId}/`,
            `companies/${companyId}/`
        ];

        for (const prefix of prefixes) {
            await bucket.deleteFiles({ prefix });
            console.log(`Deleted storage prefix: ${prefix}`);
        }

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

    const { sourceCompanyId, destinationCompanyId, applicationId } = request.data;

    // Support legacy/alternate signature if needed, or strictly enforce new one.
    // Client sends: sourceCompanyId, destinationCompanyId, applicationId
    if (!sourceCompanyId || !destinationCompanyId || !applicationId) {
        throw new HttpsError('invalid-argument', 'Missing required parameters for move.');
    }

    // RBAC Check: Must be Admin of the SOURCE company (or Super Admin)
    const roles = request.auth.token.roles || {};
    const globalRole = request.auth.token.globalRole || roles.globalRole;
    const isSuperAdmin = globalRole === "super_admin";
    const canMove = isSuperAdmin || roles[sourceCompanyId] === 'company_admin';

    if (!canMove) {
        throw new HttpsError('permission-denied', 'You do not have permission to move applications from this company.');
    }

    const { db } = getServices();

    try {
        await db.runTransaction(async (t) => {
            // 1. Get Source Doc
            const sourceRef = db.collection('companies').doc(sourceCompanyId).collection('applications').doc(applicationId);
            const sourceSnap = await t.get(sourceRef);

            if (!sourceSnap.exists) throw new HttpsError('not-found', 'Application not found in source company.');

            const appData = sourceSnap.data();

            // 2. Prepare Dest Data
            const destRef = db.collection('companies').doc(destinationCompanyId).collection('applications').doc(applicationId);

            const newAppData = {
                ...appData,
                companyId: destinationCompanyId,
                movedFrom: sourceCompanyId,
                movedAt: new Date(),
                status: 'New Application', // Reset status or keep it? usually reset for new company
                history: appData.history || []
            };

            // 3. Perform Move
            t.set(destRef, newAppData);
            t.delete(sourceRef);
        });

        return { success: true, message: 'Application moved successfully.' };
    } catch (e) {
        console.error("Move Application Error:", e);
        throw new HttpsError('internal', e.message);
    }
});

// --- FEATURE 4: SEND AUTOMATED EMAIL ---
exports.sendAutomatedEmail = onCall({ cors: true }, async (request) => {
    // SECURITY: Strict Auth Check
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const { companyId, recipientEmail, triggerType, placeholders } = request.data;
    if (!companyId || !recipientEmail) throw new HttpsError('invalid-argument', 'Missing parameters.');

    try {
        const { sendDynamicEmail } = require('./emailService');

        // 1. Template Selection
        let subject = "Quick follow up";
        let body = `<p>Hi ${placeholders?.driverfirstname || 'there'},</p>`;

        if (triggerType === 'no_answer') {
            subject = "We missed you!";
            body += `<p>I tried calling you regarding your interest in <strong>${placeholders?.companyname || 'our fleet'}</strong> but couldn't reach you.</p>`;
            body += `<p>When you have a moment, please give me a call back or check out our application here: <a href="https://app.safehaul.io/apply/${placeholders?.companyslug}">Apply Now</a></p>`;
        } else {
            body += `<p>I'm follow up regarding your application. Let me know if you have any questions!</p>`;
        }

        body += `<p>Best regards,<br>${placeholders?.recruitername || 'Recruiter'}</p>`;

        // 2. Send via Company SMTP
        const result = await sendDynamicEmail(companyId, recipientEmail, subject, body);
        return result;

    } catch (error) {
        console.error("Automated Email Error:", error);
        // We log but don't necessarily throw a blocking error to the UI 
        // if it's a non-critical background automation.
        return { success: false, error: error.message };
    }
});

// --- FEATURE 5: GET PERFORMANCE HISTORY (FIXED) ---
exports.getTeamPerformanceHistory = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const { companyId, startDate, endDate } = request.data;
    if (!companyId) throw new HttpsError('invalid-argument', 'Missing companyId.');

    const { db } = getServices();

    // PERMISSIONS: Check if requester is Company Admin or Super Admin
    const roles = request.auth.token.roles || {};
    const globalRole = request.auth.token.globalRole || roles.globalRole;

    // Check if user is explicit admin of THIS company
    const isCompanyAdmin = (roles[companyId] === 'company_admin') || (globalRole === 'super_admin');

    const excludedUserIds = new Set();

    try {
        // [MODIFIED] company_admins are now INCLUDED in the report for everyone.
        // Logic to exclude them has been removed.

        const start = new Date(startDate);
        const end = new Date(endDate);

        // DUAL QUERY: Fetch from both legacy 'activities' and new 'activity_logs' to ensure no data loss
        const activitiesQuery = db.collectionGroup('activities')
            .where('companyId', '==', companyId)
            .where('timestamp', '>=', start)
            .where('timestamp', '<=', end);

        const logsQuery = db.collectionGroup('activity_logs')
            .where('companyId', '==', companyId)
            .where('timestamp', '>=', start)
            .where('timestamp', '<=', end);

        let activitiesSnapshot, logsSnapshot;
        try {
            [activitiesSnapshot, logsSnapshot] = await Promise.all([
                activitiesQuery.get(),
                logsQuery.get()
            ]);
        } catch (queryError) {
            // Check for Missing Index Error
            if (queryError.code === 9 || queryError.message.includes("requires an index")) {
                console.warn(`[PERFORMANCE] Missing Index for company ${companyId}.`, queryError);
                throw new HttpsError('failed-precondition', 'System is building indexes for this report. Please try again in a few minutes.');
            }
            throw queryError; // Rethrow other errors
        }

        // MERGE RESULTS
        const allDocs = [...activitiesSnapshot.docs, ...logsSnapshot.docs];
        console.log(`[PERFORMANCE] Raw Docs Found: ${activitiesSnapshot.size} (activities) + ${logsSnapshot.size} (logs) = ${allDocs.length} total.`);

        const statsByUser = {};
        const dailyStats = {}; // { "YYYY-MM-DD": { userId: { uniqueCalls: 0 } } }

        // Deduplicate Docs by ID first (in case of overlap)
        const uniqueDocs = new Map();
        allDocs.forEach(doc => uniqueDocs.set(doc.id, doc.data()));

        // GROUP BY RECRUITER -> LEAD -> CALLS
        const recruiterActivityMap = {}; // { userId: { leadId: [timestamps] } }

        uniqueDocs.forEach((data) => {
            const userId = data.performedBy || 'unknown';
            const leadId = data.leadId || data.applicationId || data.targetId || 'unknown_lead';

            // Only count CONTACT calls (ignore notes, status changes unless requested)
            // If type is missing, we assume it's a call if it has an outcome? 
            // Better to be permissive for legacy data, but stricter for new data.
            const isCall = data.type === 'call' || (!data.type && data.outcome);

            if (!isCall) return;

            // Safe Date Parsing
            let dateObj;
            try {
                if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                    dateObj = data.timestamp.toDate();
                } else if (data.timestamp instanceof Date) {
                    dateObj = data.timestamp;
                } else {
                    return;
                }
            } catch (err) { return; }

            if (!recruiterActivityMap[userId]) recruiterActivityMap[userId] = {};
            if (!recruiterActivityMap[userId][leadId]) recruiterActivityMap[userId][leadId] = [];

            recruiterActivityMap[userId][leadId].push({
                timestamp: dateObj,
                data: data
            });
        });

        // APPLY 7-DAY LOGIC
        Object.keys(recruiterActivityMap).forEach(userId => {
            // Initialize User Stats
            if (!statsByUser[userId]) {
                const userName = recruiterActivityMap[userId]['unknown_lead']?.[0]?.data?.performedByName || 'Unknown';
                // We might need to find a better name source if 'unknown_lead' isn't there. 
                // Just use the first available name.
                let firstData = null;
                for (const lid in recruiterActivityMap[userId]) {
                    if (recruiterActivityMap[userId][lid].length > 0) {
                        firstData = recruiterActivityMap[userId][lid][0].data;
                        break;
                    }
                }

                statsByUser[userId] = {
                    id: userId,
                    name: firstData?.performedByName || 'Unknown Recruiter',
                    dials: 0,
                    connected: 0,
                    callback: 0, notInt: 0, notQual: 0, vm: 0,
                    rawCallCount: 0 // Debugging info
                };
            }

            const leads = recruiterActivityMap[userId];
            Object.keys(leads).forEach(leadId => {
                const calls = leads[leadId].sort((a, b) => a.timestamp - b.timestamp);

                let lastCountedTime = 0;

                calls.forEach(call => {
                    statsByUser[userId].rawCallCount++; // Track raw attempts

                    const time = call.timestamp.getTime();
                    const diffDays = (time - lastCountedTime) / (1000 * 60 * 60 * 24);

                    // 7-DAY RULE: Count if first call OR > 7 days since last COUNTED call
                    if (lastCountedTime === 0 || diffDays > 7) {
                        statsByUser[userId].dials++;
                        lastCountedTime = time;

                        // Add to Daily Stats (using the counted date)
                        const dateKey = call.timestamp.toISOString().split('T')[0];
                        if (!dailyStats[dateKey]) dailyStats[dateKey] = {};
                        if (!dailyStats[dateKey][userId]) dailyStats[dateKey][userId] = 0;
                        dailyStats[dateKey][userId]++;

                        // Log Outcome Stats (Only for counted calls? Or all calls? 
                        // Usually stats like 'Connected' should track *unique* engagements too to match 'Dials')
                        const outcome = call.data.outcome;
                        const isContact = call.data.isContact;

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
                                if (isContact) statsByUser[userId].connected++;
                                break;
                        }
                    }
                });
            });
        });

        // Format Daily Stats for Frontend Graph { name: "MM/DD", userId: count, ... }
        const formattedHistory = Object.keys(dailyStats).sort().map(dateKey => {
            const dateObj = new Date(dateKey);
            // Format nice display date (e.g. "10/24")
            const displayDate = `${dateObj.getUTCMonth() + 1}/${dateObj.getUTCDate()}`;

            const point = { name: displayDate, fullDate: dateKey };

            // Add each user's count to the point
            Object.keys(dailyStats[dateKey]).forEach(uid => {
                point[uid] = dailyStats[dateKey][uid];
            });
            return point;
        });

        return {
            success: true,
            data: Object.values(statsByUser), // Summary (Leaderboard)
            history: formattedHistory         // Time Series (Graph)
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
    // SECURITY: Strict Auth Check (Super Admin Only recommended, but at least Auth)
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

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