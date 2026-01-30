// functions/leadDistribution.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { admin, db } = require("./firebaseAdmin"); // <--- Added admin/db imports
const Sentry = require("@sentry/node"); // <--- Sentry for error reporting
const {
    runLeadDistribution,
    populateLeadsFromDrivers,
    runCleanup,
    processLeadOutcome,
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
// --- 1. PLANNING PHASE (REMOVED) ---
// Previously scheduled for 6:00 AM. Removed as "useless" dry-run for now.
// To restore: Re-add onSchedule trigger calling runLeadDistribution(false).

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
        Sentry.captureException(error); // Report to Sentry
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
        Sentry.captureException(error); // Report to Sentry
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
        Sentry.captureException(error); // Report to Sentry
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
        Sentry.captureException(error); // Report to Sentry
        return { success: false, error: error.message };
    }
});

// --- 5. ANALYTICS (REMOVED) ---
// generateDailyAnalytics was imported but never existed in leadLogic.js
// This scheduled job has been removed to prevent runtime errors

// --- 6. DRIVER INTEREST ---
exports.confirmDriverInterest = onCall(RUNTIME_OPTS, async (request) => {
    const { leadId, companyId, recruiterId } = request.data;
    try {
        const result = await confirmDriverInterest(request.data);
        return result;
    } catch (error) {
        Sentry.captureException(error); // Report to Sentry
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

// --- 9. RECALL ALL PLATFORM LEADS ---
// Removes all distributed leads (isPlatformLead=true) from all companies
exports.recallAllPlatformLeads = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin only.");
    }

    try {
        console.log("Recalling all platform leads from all companies...");

        // Query all company leads that are platform leads
        const distributedSnap = await db.collectionGroup("leads")
            .where("isPlatformLead", "==", true)
            .get();

        if (distributedSnap.empty) {
            return { success: true, message: "No platform leads to recall.", deletedCount: 0 };
        }

        // Batch delete
        let batch = db.batch();
        let batchCount = 0;
        let totalDeleted = 0;
        const originalLeadIds = [];

        for (const doc of distributedSnap.docs) {
            const data = doc.data();
            if (data.originalLeadId) {
                originalLeadIds.push(data.originalLeadId);
            }
            batch.delete(doc.ref);
            batchCount++;
            totalDeleted++;

            if (batchCount >= 400) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
            }
        }

        if (batchCount > 0) {
            await batch.commit();
        }

        // Unlock the original leads in the global pool
        if (originalLeadIds.length > 0) {
            let unlockBatch = db.batch();
            let unlockCount = 0;

            for (const leadId of originalLeadIds) {
                const leadRef = db.collection("leads").doc(leadId);
                unlockBatch.update(leadRef, { unavailableUntil: null });
                unlockCount++;

                if (unlockCount >= 400) {
                    await unlockBatch.commit();
                    unlockBatch = db.batch();
                    unlockCount = 0;
                }
            }

            if (unlockCount > 0) {
                await unlockBatch.commit();
            }
        }

        console.log(`Recalled ${totalDeleted} platform leads, unlocked ${originalLeadIds.length} global leads.`);
        return {
            success: true,
            message: `Recalled ${totalDeleted} platform leads from all companies.`,
            deletedCount: totalDeleted,
            unlockedCount: originalLeadIds.length
        };

    } catch (error) {
        console.error("Recall Error:", error);
        Sentry.captureException(error);
        throw new HttpsError("internal", error.message);
    }
});

// --- 10. FORCE UNLOCK POOL ---
// Clears all unavailableUntil timestamps to make entire pool available
exports.forceUnlockPool = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin only.");
    }

    try {
        console.log("Force unlocking entire lead pool...");
        const now = admin.firestore.Timestamp.now();

        // Query all locked leads
        const lockedSnap = await db.collection("leads")
            .where("unavailableUntil", ">", now)
            .get();

        if (lockedSnap.empty) {
            return { success: true, message: "No locked leads to unlock.", unlockedCount: 0 };
        }

        let batch = db.batch();
        let batchCount = 0;
        let totalUnlocked = 0;

        for (const doc of lockedSnap.docs) {
            batch.update(doc.ref, { unavailableUntil: null });
            batchCount++;
            totalUnlocked++;

            if (batchCount >= 400) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
            }
        }

        if (batchCount > 0) {
            await batch.commit();
        }

        console.log(`Unlocked ${totalUnlocked} leads.`);
        return {
            success: true,
            message: `Unlocked ${totalUnlocked} leads. Entire pool is now available.`,
            unlockedCount: totalUnlocked
        };

    } catch (error) {
        console.error("Unlock Error:", error);
        Sentry.captureException(error);
        throw new HttpsError("internal", error.message);
    }
});

// --- 11. BAD LEADS ANALYTICS (OPTIMIZED) ---
// Reads cached stats instead of scanning.
exports.getBadLeadsAnalytics = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin only.");
    }
    try {
        const doc = await db.collection("system_settings").doc("lead_pool_stats").get();
        if (!doc.exists) return { success: false, message: "Stats calculation pending. Please wait for scheduled job." };
        return { success: true, ...doc.data() };
    } catch (error) {
        Sentry.captureException(error);
        throw new HttpsError("internal", error.message);
    }
});

// --- 13. REBUILD LEAD STATS (Background Worker) ---
// Scans database to populate the cache. Runs monthly to correct drift.
exports.rebuildLeadStats = onSchedule({
    schedule: "0 3 1 * *", // 1st of month at 3 AM
    timeZone: "America/Chicago",
    timeoutSeconds: 540,
    memory: '1GiB'
}, async (event) => {
    try {
        console.log("Starting full lead pool scan for analytics...");
        const leadsSnap = await db.collection("leads").get();

        let stats = {
            total: leadsSnap.size,
            missingContact: 0,
            missingNames: 0,
            placeholderEmails: 0,
            shortPhones: 0,
            testData: 0,
            duplicatePhones: 0
        };

        const phoneMap = new Map();

        leadsSnap.forEach(doc => {
            const d = doc.data();
            const phone = d.phone || d.normalizedPhone || '';
            const email = d.email || '';
            const firstName = d.firstName || '';
            const lastName = d.lastName || '';
            const name = `${firstName} ${lastName} ${d.fullName || ''}`.toLowerCase();

            if (!phone && !email) stats.missingContact++;
            if (!firstName && !lastName && !d.fullName) stats.missingNames++;
            if (email.includes('placeholder') || email.includes('no_email')) stats.placeholderEmails++;

            const cleanPhone = phone.replace(/\D/g, '');
            if (cleanPhone && cleanPhone.length < 10) stats.shortPhones++;
            if (name.includes('test') || name.includes('health check')) stats.testData++;

            if (cleanPhone && cleanPhone.length >= 10) {
                phoneMap.set(cleanPhone, (phoneMap.get(cleanPhone) || 0) + 1);
            }
        });

        for (const [phone, count] of phoneMap) {
            if (count > 1) stats.duplicatePhones += count - 1;
        }

        // Save Cache
        await db.collection('system_settings').doc('lead_pool_stats').set({
            stats: stats,
            breakdown: {
                critical: stats.missingContact + stats.testData,
                warning: stats.placeholderEmails + stats.shortPhones + stats.missingNames,
                info: stats.duplicatePhones
            },
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log("Lead stats rebuilt successfully.");
    } catch (error) {
        console.error("Rebuild Stats Failed:", error);
        Sentry.captureException(error);
    }
});

// --- 12. GET COMPANY DISTRIBUTION STATUS ---
// Fetches all companies with their distribution stats
exports.getCompanyDistributionStatus = onCall(RUNTIME_OPTS, async (request) => {
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin only.");
    }

    try {
        console.log("Fetching company distribution status...");

        // Get all companies
        const companiesSnap = await db.collection("companies").orderBy("companyName", "asc").get();

        const companies = [];

        for (const companyDoc of companiesSnap.docs) {
            const data = companyDoc.data();
            const companyId = companyDoc.id;

            // Count platform leads
            const platformSnap = await db.collection(`companies/${companyId}/leads`)
                .where("isPlatformLead", "==", true)
                .count()
                .get();

            // Count private leads
            const privateSnap = await db.collection(`companies/${companyId}/leads`)
                .where("isPlatformLead", "==", false)
                .count()
                .get();

            // Get last distribution time from company document
            const lastDistTimestamp = data.lastDistributionAt;

            // Calculate next distribution (7 AM Central Time)
            const now = new Date();
            const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));

            // Create next 7 AM CT
            const nextDist = new Date(central);
            nextDist.setHours(7, 0, 0, 0);

            // If it's already past 7 AM today, move to tomorrow
            if (central.getHours() >= 7) {
                nextDist.setDate(nextDist.getDate() + 1);
            }

            // Calculate countdown
            const msUntilNext = nextDist.getTime() - central.getTime();
            const hoursUntil = Math.floor(msUntilNext / (1000 * 60 * 60));
            const minutesUntil = Math.floor((msUntilNext % (1000 * 60 * 60)) / (1000 * 60));

            companies.push({
                id: companyId,
                companyName: data.companyName || "Unknown",
                slug: data.slug || companyId,
                isActive: data.isActive || false,
                dailyQuota: (data.quotaPaidPlan || 0) + (data.quotaFreePlan || 0),
                platformLeadsCount: platformSnap.data().count,
                privateLeadsCount: privateSnap.data().count,
                lastDistribution: lastDistTimestamp ? {
                    date: lastDistTimestamp.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                    time: lastDistTimestamp.toDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
                    timestamp: lastDistTimestamp.toMillis()
                } : null,
                nextDistribution: data.isActive ? {
                    countdown: `${hoursUntil}h ${minutesUntil}m`,
                    exactTime: nextDist.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }),
                    timestamp: nextDist.getTime()
                } : null
            });
        }

        return {
            success: true,
            companies: companies,
            totalCompanies: companies.length,
            activeCompanies: companies.filter(c => c.isActive).length
        };

    } catch (error) {
        console.error("Company Distribution Status Error:", error);
        Sentry.captureException(error);
        throw new HttpsError("internal", error.message);
    }
});