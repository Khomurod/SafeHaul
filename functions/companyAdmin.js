// functions/companyAdmin.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { admin, db } = require("./firebaseAdmin");
const { deleteCompanySchema, sendEmailSchema } = require("./shared/schema");

// --- IN-MEMORY CACHE FOR SLUG RESOLUTION (REMOVED - HANDLED CLIENT SIDE) ---

// --- FEATURE 2: DELETE COMPANY (Admin Only - Refactored for Stability) ---
exports.deleteCompany = onCall({
    cors: true,
    timeoutSeconds: 540, // Maximize timeout for deletion operations
    memory: '1GiB'
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

    // INPUT VALIDATION
    const { error, value } = deleteCompanySchema.validate(request.data);
    if (error) throw new HttpsError('invalid-argument', error.message);
    const { companyId } = value;

    // STRICTER AUTH: Use the custom claim we set in rules/auth logic
    const roles = request.auth.token.roles || {};
    const globalRole = request.auth.token.globalRole || roles.globalRole;
    const isSuperAdmin = globalRole === "super_admin";

    if (!isSuperAdmin) throw new HttpsError('permission-denied', 'Only Super Admins can delete companies.');

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

// REMOVED: moveApplication - now handled via direct Firestore Transaction in applicationService.js


// --- FEATURE 4: SEND AUTOMATED EMAIL ---
exports.sendAutomatedEmail = onCall({ cors: true }, async (request) => {
    // SECURITY: Strict Auth Check
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    // INPUT VALIDATION
    const { error, value } = sendEmailSchema.validate(request.data);
    if (error) throw new HttpsError('invalid-argument', error.message);
    const { companyId, recipientEmail, triggerType, placeholders } = value;

    try {
        const { sendDynamicEmail } = require('./emailService');

        // 1. Template Selection
        let subject = "Quick follow up";
        let body = `<p>Hi ${placeholders?.driverfirstname || 'there'},</p>`;

        if (triggerType === 'manual_email') {
            subject = placeholders?.subject || 'Message from SafeHaul';
            body = placeholders?.body || '';
        } else if (triggerType === 'pev_request') {
            subject = `Previous Employment Verification Request – ${placeholders?.applicantname || 'Applicant'}`;
            body = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: #1e293b; color: white; padding: 20px 24px; border-radius: 8px 8px 0 0;">
                        <h2 style="margin: 0; font-size: 18px;">📋 Previous Employment Verification Request</h2>
                        <p style="margin: 4px 0 0; font-size: 13px; color: #94a3b8;">FMCSA 49 CFR Part 391.23 Compliance</p>
                    </div>
                    <div style="background: white; padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
                        <p>Dear ${placeholders?.employername || 'Former Employer'},</p>
                        <p>We are writing to verify the employment history of <strong>${placeholders?.applicantname || 'the applicant'}</strong>, who has applied for a commercial driving position with <strong>${placeholders?.companyname || 'our company'}</strong>.</p>
                        <p>Under <strong>FMCSA 49 CFR Part 391.23</strong>, prospective employers of commercial motor vehicle drivers are required to investigate the driver's employment record for the preceding 3 years. Your cooperation in providing this information is required by federal regulation.</p>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 20px 0;">
                            <h3 style="margin: 0 0 12px; font-size: 14px; color: #334155;">Applicant Details</h3>
                            <table style="width: 100%; font-size: 14px; color: #475569;">
                                <tr><td style="padding: 4px 0;"><strong>Name:</strong></td><td>${placeholders?.applicantname || 'N/A'}</td></tr>
                                <tr><td style="padding: 4px 0;"><strong>Reported Dates:</strong></td><td>${placeholders?.employmentdates || 'N/A'}</td></tr>
                            </table>
                        </div>
                        <p>Please reply to this email with the completed verification, or contact us if you have any questions.</p>
                        <p>Thank you for your prompt attention to this matter.</p>
                        <p>Best regards,<br><strong>${placeholders?.companyname || 'HR Department'}</strong></p>
                    </div>
                    <div style="background: #f1f5f9; padding: 12px 24px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0; border-top: none;">
                        <p style="margin: 0; font-size: 11px; color: #94a3b8; text-align: center;">This request was generated by SafeHaul Compliance Services</p>
                    </div>
                </div>`;
        } else if (triggerType === 'no_answer') {
            subject = "We missed you!";
            body += `<p>I tried calling you regarding your interest in <strong>${placeholders?.companyname || 'our fleet'}</strong> but couldn't reach you.</p>`;
            body += `<p>When you have a moment, please give me a call back or check out our application here: <a href="https://app.safehaul.io/apply/${placeholders?.companyslug}">Apply Now</a></p>`;
            body += `<p>Best regards,<br>${placeholders?.recruitername || 'Recruiter'}</p>`;
        } else {
            body += `<p>I'm follow up regarding your application. Let me know if you have any questions!</p>`;
            body += `<p>Best regards,<br>${placeholders?.recruitername || 'Recruiter'}</p>`;
        }

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

// --- FEATURE 6: MANUAL MIGRATION TOOL ---

// --- FEATURE 6: MANUAL MIGRATION TOOL ---
const migrationLogic = onCall({
    cors: true, region: "us-central1", maxInstances: 10
}, async (request) => {
    // P1-5 FIX: Require super_admin role, not just authentication
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    if (!request.auth.token?.super_admin) {
        throw new HttpsError('permission-denied', 'Super admin access required for migrations.');
    }

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
// migrateDriversToLeads removed - real implementation is in leadDistribution.js

/**
 * BACKFILL PUBLIC PROFILES
 * One-time callable function to force-sync ALL companies to public_profiles.
 * Use this to repair stale data or after deploying syncPublicProfile for the first time.
 * Safe to run multiple times (idempotent via merge: true).
 */
exports.backfillPublicProfiles = onCall({
    cors: true, region: "us-central1", maxInstances: 1,
    timeoutSeconds: 300, memory: '512MiB'
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    // Super Admin check
    const roles = request.auth.token.roles || {};
    const globalRole = request.auth.token.globalRole || roles.globalRole;
    if (globalRole !== "super_admin") {
        throw new HttpsError('permission-denied', 'Only Super Admins can run backfills.');
    }

    try {
        const snapshot = await db.collection('companies').get();
        let batch = db.batch();
        let count = 0;
        let totalSynced = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const publicData = {
                companyName: data.companyName || "Untitled Company",
                appSlug: data.appSlug || null,
                logoUrl: data.companyLogoUrl || null,
                brandColor: data.brandColor || "#1e40af",
                isActive: data.isActive ?? true,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            batch.set(db.collection('public_profiles').doc(doc.id), publicData, { merge: true });
            count++;
            totalSynced++;

            if (count >= 400) {
                await batch.commit();
                batch = db.batch();
                count = 0;
            }
        }
        if (count > 0) await batch.commit();

        console.log(`[backfillPublicProfiles] Synced ${totalSynced} companies.`);
        return { success: true, message: `Backfilled ${totalSynced} public profiles.` };
    } catch (error) {
        console.error('[backfillPublicProfiles] Error:', error);
        return { success: false, error: error.message };
    }
});


/**
 * SYNC PUBLIC PROFILE
 * Trigger: onWrite /companies/{companyId}
 * Description: Copies ONLY safe public data to a separate collection for public read access.
 * This prevents exposing sensitive company data (revenue, internal notes, quotas) to the public.
 */
exports.syncPublicProfile = onDocumentWritten("companies/{companyId}", async (event) => {
    const companyId = event.params.companyId;
    const newData = event.data.after.exists ? event.data.after.data() : null;

    // If company is deleted, delete public profile
    if (!newData) {
        await db.collection("public_profiles").doc(companyId).delete();
        console.log(`[syncPublicProfile] Deleted public profile for ${companyId}`);
        return;
    }

    // SELECT ONLY SAFE FIELDS
    const publicData = {
        companyName: newData.companyName || "Untitled Company",
        appSlug: newData.appSlug || null,
        logoUrl: newData.companyLogoUrl || null,
        brandColor: newData.brandColor || "#1e40af",
        isActive: newData.isActive ?? true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection("public_profiles").doc(companyId).set(publicData, { merge: true });
    console.log(`[syncPublicProfile] Synced public profile for ${companyId}`);
});