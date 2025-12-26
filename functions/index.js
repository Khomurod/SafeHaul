const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

// Initialize Admin SDK once
if (!admin.apps.length) {
  admin.initializeApp();
}

// --- IMPORT MODULES ---
const driverSync = require('./driverSync');
const hrAdmin = require('./hrAdmin');
const companyAdmin = require('./companyAdmin');
const leadLogic = require('./leadLogic'); // Keep for legacy if needed, or use leadDistribution
const leadDistribution = require('./leadDistribution');
const digitalSealing = require('./digitalSealing');
const notifySigner = require('./notifySigner');
const publicSigning = require('./publicSigning'); // <--- NEW IMPORT

// --- EXPORTS ---

// 1. Docs & Email & Public Signing
exports.sealDocument = digitalSealing.sealDocument;
exports.notifySigner = notifySigner.notifySigner; 
exports.getPublicEnvelope = publicSigning.getPublicEnvelope;    // <--- NEW
exports.submitPublicEnvelope = publicSigning.submitPublicEnvelope; // <--- NEW

// 2. Auth & User Management
exports.createPortalUser = hrAdmin.createPortalUser;
exports.deletePortalUser = hrAdmin.deletePortalUser;
exports.updatePortalUser = hrAdmin.updatePortalUser;
exports.onMembershipWrite = hrAdmin.onMembershipWrite; // Corrected source: hrAdmin

// 3. Company Admin
exports.getCompanyProfile = companyAdmin.getCompanyProfile;
exports.joinCompanyTeam = hrAdmin.joinCompanyTeam; // Corrected source: hrAdmin
exports.deleteCompany = companyAdmin.deleteCompany;
exports.getTeamPerformanceHistory = companyAdmin.getTeamPerformanceHistory;

// 4. Applications & Driver Sync
exports.onApplicationSubmitted = driverSync.onApplicationSubmitted; // Corrected source: driverSync
exports.onLeadSubmitted = driverSync.onLeadSubmitted; // Corrected source: driverSync
exports.moveApplication = companyAdmin.moveApplication;
exports.sendAutomatedEmail = companyAdmin.sendAutomatedEmail;

// 5. Leads & Distribution
exports.cleanupBadLeads = leadDistribution.cleanupBadLeads;
exports.handleLeadOutcome = leadDistribution.handleLeadOutcome;
exports.migrateDriversToLeads = leadDistribution.migrateDriversToLeads;
exports.confirmDriverInterest = leadDistribution.confirmDriverInterest;
exports.runLeadDistribution = leadDistribution.runLeadDistribution;
exports.distributeDailyLeads = leadDistribution.distributeDailyLeads; // Manual trigger
exports.distributeDailyLeadsScheduled = leadDistribution.distributeDailyLeadsScheduled; // Scheduled

// 6. Data Migration
exports.runMigration = companyAdmin.runMigration;

// 7. Analytics (Commented out to prevent Gen 1 CPU errors)
/*
exports.aggregateAnalytics = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
    const analytics = require('./leadDistribution');
    return analytics.aggregateAnalytics(context);
});
*/