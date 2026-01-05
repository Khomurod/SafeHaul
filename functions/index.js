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
// Lead Logic removed (using leadDistribution)
const leadDistribution = require('./leadDistribution');
const digitalSealing = require('./digitalSealing');
const notifySigner = require('./notifySigner');
const publicSigning = require('./publicSigning');
const systemIntegrity = require('./systemIntegrity');
const searchHandler = require('./searchHandler'); // <--- NEW IMPORT

// --- EXPORTS ---

// 1. Docs & Email & Public Signing
exports.sealDocument = digitalSealing.sealDocument;
exports.notifySigner = notifySigner.notifySigner;
exports.getPublicEnvelope = publicSigning.getPublicEnvelope;
exports.submitPublicEnvelope = publicSigning.submitPublicEnvelope;

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
exports.getLeadSupplyAnalytics = leadDistribution.getLeadSupplyAnalytics;
exports.bulkAssignLeads = leadDistribution.bulkAssignLeads; // <--- Preserved from previous step

// 6. System Integrity
exports.syncSystemStructure = systemIntegrity.syncSystemStructure;
exports.runSecurityAudit = systemIntegrity.runSecurityAudit; // <--- FIX: Export Security Audit
exports.getSignedUploadUrl = require('./storageSecure').getSignedUploadUrl; // <--- NEW EXPORT 

// NEW: Email Testing
exports.testEmailConnection = require('./testEmailConnection').testEmailConnection;


// 7. Data Migration
exports.runMigration = companyAdmin.runMigration;

// 8. Global Search (NEW)
exports.searchUnifiedData = searchHandler.searchUnifiedData;

// 9. Scheduled Jobs
const customJobs = require('./customJobs');
exports.checkDocumentExpirations = customJobs.checkDocumentExpirations;

// 9. Analytics (Commented out to prevent Gen 1 CPU errors)
/*
exports.aggregateAnalytics = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
    const analytics = require('./leadDistribution');
    return analytics.aggregateAnalytics(context);
});
*/