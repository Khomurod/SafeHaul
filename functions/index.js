const Sentry = require("@sentry/node");

// Initialize Sentry ASAP (before any other code)
Sentry.init({
  dsn: "https://a65b9de0dd496035cfa65d0543f2c566@o4510692386799616.ingest.us.sentry.io/4510692400365568",
  tracesSampleRate: 1.0,
});

const functions = require('firebase-functions/v1');
const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

// Initialize Admin SDK once
if (!admin.apps.length) {
  admin.initializeApp();
}

// --- IMPORT MODULES ---
const driverSync = require('./driverSync');
const hrAdmin = require('./hrAdmin');
const companyAdmin = require('./companyAdmin');
const leadDistribution = require('./leadDistribution');
const digitalSealing = require('./digitalSealing');
const notifySigner = require('./notifySigner');
const publicSigning = require('./publicSigning');
const systemIntegrity = require('./systemIntegrity');
const statsAggregator = require('./statsAggregator');
const searchHandler = require('./searchHandler');

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
exports.onMembershipWrite = hrAdmin.onMembershipWrite;

// 3. Company Admin
exports.getCompanyProfile = companyAdmin.getCompanyProfile;
exports.joinCompanyTeam = hrAdmin.joinCompanyTeam;
exports.deleteCompany = companyAdmin.deleteCompany;
exports.getTeamPerformanceHistory = companyAdmin.getTeamPerformanceHistory;

// 4. Applications & Driver Sync
exports.onApplicationSubmitted = driverSync.onApplicationSubmitted;
exports.onLeadSubmitted = driverSync.onLeadSubmitted;
exports.syncDriverOnLog = driverSync.syncDriverOnLog;
exports.syncDriverOnActivity = driverSync.syncDriverOnActivity;
exports.moveApplication = companyAdmin.moveApplication;
exports.sendAutomatedEmail = companyAdmin.sendAutomatedEmail;

// 5. Leads & Distribution
exports.cleanupBadLeads = leadDistribution.cleanupBadLeads;
exports.handleLeadOutcome = leadDistribution.handleLeadOutcome;
exports.migrateDriversToLeads = leadDistribution.migrateDriversToLeads;
exports.confirmDriverInterest = leadDistribution.confirmDriverInterest;
exports.runLeadDistribution = leadDistribution.runLeadDistribution;
exports.planLeadDistribution = leadDistribution.planLeadDistribution;
exports.distributeDailyLeads = leadDistribution.distributeDailyLeads;
exports.getLeadSupplyAnalytics = leadDistribution.getLeadSupplyAnalytics;

// 6. System Integrity
exports.syncSystemStructure = systemIntegrity.syncSystemStructure;
exports.runSecurityAudit = systemIntegrity.runSecurityAudit;
exports.getSignedUploadUrl = require('./storageSecure').getSignedUploadUrl;

// NEW: Email Testing
exports.testEmailConnection = require('./testEmailConnection').testEmailConnection;

// 7. Data Migration
exports.runMigration = companyAdmin.runMigration;

// 8. Global Search
exports.searchUnifiedData = searchHandler.searchUnifiedData;

// 9. Scheduled Jobs
const customJobs = require('./customJobs');
exports.debugAppCounts = customJobs.debugAppCounts;

// 10. Integrations
const facebook = require('./integrations/facebook');
const smsIntegrations = require('./integrations/index');

exports.connectFacebookPage = facebook.connectFacebookPage;
exports.facebookWebhook = facebook.facebookWebhook;
exports.saveIntegrationConfig = smsIntegrations.saveIntegrationConfig;
exports.sendTestSMS = smsIntegrations.sendTestSMS;
exports.executeReactivationBatch = smsIntegrations.executeReactivationBatch;
exports.assignPhoneNumber = smsIntegrations.assignPhoneNumber;
exports.addManualPhoneNumber = smsIntegrations.addManualPhoneNumber;

// Digital Wallet
exports.addPhoneLine = smsIntegrations.addPhoneLine;
exports.removePhoneLine = smsIntegrations.removePhoneLine;
exports.testLineConnection = smsIntegrations.testLineConnection;

// 11. Stats Aggregation
exports.onActivityLogCreated = statsAggregator.onActivityLogCreated;
exports.onLegacyActivityCreated = statsAggregator.onLegacyActivityCreated;
exports.onLeadsActivityLogCreated = statsAggregator.onLeadsActivityLogCreated; // NEW: Leads trigger

// 12. Cloud Tasks Worker
exports.processCompanyDistribution = require('./workers/distributeWorker').processCompanyDistribution;

// 13. Stats Backfill (Admin Tools)
const statsBackfill = require('./statsBackfill');
exports.backfillCompanyStats = statsBackfill.backfillCompanyStats;
exports.backfillAllStats = statsBackfill.backfillAllStats;

// --- DEPRECATED: Legacy migration (kept for reference but superseded by statsBackfill) ---
// exports.migrateLegacyActivities = require('./migrateLegacyActivities').migrateLegacyActivities;