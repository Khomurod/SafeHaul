// functions/companyAdmin.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("./firebaseAdmin");


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

    // db is already available from top-level import
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

    // const { db, admin } = getServices(); // REMOVED
    const storage = admin.storage();

    try {
        // 1. Recursive Delete using native Admin SDK (No external dependency required)
        console.log(`Starting recursive delete for company: ${companyId}`);
        const companyRef = db.collection('companies').doc(companyId);
        await db.recursiveDelete(companyRef);

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

    // db is already available from top-level import

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

// --- FEATURE 5: GET PERFORMANCE HISTORY (OPTIMIZED - Uses Pre-Aggregated Stats) ---
exports.getTeamPerformanceHistory = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const { companyId, startDate, endDate } = request.data;
    if (!companyId) throw new HttpsError('invalid-argument', 'Missing companyId.');

    // db is already available from top-level import

    // PERMISSIONS: Check if requester is Company Admin or Super Admin
    const roles = request.auth.token.roles || {};
    const globalRole = request.auth.token.globalRole || roles.globalRole;
    const isCompanyAdmin = (roles[companyId] === 'company_admin') || (globalRole === 'super_admin');

    try {
        // Format dates for document ID range query (YYYY-MM-DD) in CHICAGO TIMEZONE
        // This aligns with statsAggregator which uses Chicago time for dateKey
        const chicagoFormatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });

        // Parse the incoming dates and format to Chicago timezone
        const startKey = chicagoFormatter.format(new Date(startDate));
        const endKey = chicagoFormatter.format(new Date(endDate));

        console.log(`[PERFORMANCE] Querying stats_daily from ${startKey} to ${endKey} (Chicago TZ)`);

        // OPTIMIZED: Query pre-aggregated daily stats (~30 docs max for a month)
        const statsSnapshot = await db.collection('companies').doc(companyId)
            .collection('stats_daily')
            .where('__name__', '>=', startKey)
            .where('__name__', '<=', endKey)
            .orderBy('__name__')
            .get();

        console.log(`[PERFORMANCE] Found ${statsSnapshot.size} daily stats documents`);

        // Aggregate user summaries across all days
        const userTotals = {}; // { userId: { name, dials, connected, ... } }
        const formattedHistory = [];

        statsSnapshot.forEach(doc => {
            const dateKey = doc.id;
            const data = doc.data();

            // Build the history point for this day
            const dateObj = new Date(dateKey + 'T00:00:00Z');
            const displayDate = `${dateObj.getUTCMonth() + 1}/${dateObj.getUTCDate()}`;
            const point = { name: displayDate, fullDate: dateKey };

            // Process per-user stats for this day
            const byUser = data.byUser || {};
            Object.keys(byUser).forEach(userId => {
                const userData = byUser[userId];

                // Add to history point
                point[userId] = userData.dials || 0;

                // Aggregate into user totals
                if (!userTotals[userId]) {
                    userTotals[userId] = {
                        id: userId,
                        name: userData.name || 'Unknown Recruiter',
                        dials: 0,
                        connected: 0,
                        voicemail: 0,
                        callback: 0,
                        notInt: 0,
                        notQual: 0
                    };
                }
                userTotals[userId].dials += (userData.dials || 0);
                userTotals[userId].connected += (userData.connected || 0);
            });

            // Also aggregate company-wide outcome stats from the daily doc
            formattedHistory.push(point);
        });

        // Fallback: If no pre-aggregated stats exist yet, return empty but valid response
        if (statsSnapshot.empty) {
            console.warn(`[PERFORMANCE] No stats_daily docs found for ${companyId}. Returning empty data.`);
            return {
                success: true,
                data: [],
                history: [],
                message: 'No aggregated stats available yet. Stats will populate as new activities are logged.'
            };
        }

        return {
            success: true,
            data: Object.values(userTotals), // Summary (Leaderboard)
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
        // const { db } = getServices(); // REMOVED
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