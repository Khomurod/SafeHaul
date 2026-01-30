const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

// Initialize Admin SDK once
if (!admin.apps.length) {
  admin.initializeApp();
}

// Bulk Actions (Resilient session-based)
// Note: pause/resume/cancel moved to frontend direct Firestore writes
const bulkActions = require('./bulkActions');
exports.initBulkSession = bulkActions.initBulkSession;
exports.processBulkBatch = bulkActions.processBulkBatch;
exports.retryFailedAttempts = bulkActions.retryFailedAttempts;
exports.getFilterCount = bulkActions.getFilterCount;
exports.getFilteredLeadsPage = bulkActions.getFilteredLeadsPage;
exports.resumeBulkSession = bulkActions.resumeBulkSession;
exports.pauseBulkSession = bulkActions.pauseBulkSession;
exports.cancelBulkSession = bulkActions.cancelBulkSession;

// Templates - REMOVED: All CRUD operations moved to frontend SDK


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
// REMOVED: getCompanyProfile, resolveCompanySlug, getTeamPerformanceHistory - moved to frontend SDK
exports.joinCompanyTeam = hrAdmin.joinCompanyTeam;
exports.deleteCompany = companyAdmin.deleteCompany;

// 4. Applications & Driver Sync
exports.onApplicationSubmitted = driverSync.onApplicationSubmitted;
exports.onLeadSubmitted = driverSync.onLeadSubmitted;
exports.syncDriverOnLog = driverSync.syncDriverOnLog;
exports.syncDriverOnActivity = driverSync.syncDriverOnActivity;
// REMOVED: moveApplication - now handled via direct Firestore Transaction
exports.sendAutomatedEmail = companyAdmin.sendAutomatedEmail;


// 5. Leads & Distribution
exports.cleanupBadLeads = leadDistribution.cleanupBadLeads;
exports.handleLeadOutcome = leadDistribution.handleLeadOutcome;
exports.migrateDriversToLeads = leadDistribution.migrateDriversToLeads;
exports.confirmDriverInterest = leadDistribution.confirmDriverInterest;
exports.runLeadDistribution = leadDistribution.runLeadDistribution;
// exports.planLeadDistribution = leadDistribution.planLeadDistribution; // REMOVED
exports.distributeDailyLeads = leadDistribution.distributeDailyLeads;
exports.getLeadSupplyAnalytics = leadDistribution.getLeadSupplyAnalytics;
// Lead Pool Management (new)
exports.recallAllPlatformLeads = leadDistribution.recallAllPlatformLeads;
exports.forceUnlockPool = leadDistribution.forceUnlockPool;
exports.getBadLeadsAnalytics = leadDistribution.getBadLeadsAnalytics;
exports.getCompanyDistributionStatus = leadDistribution.getCompanyDistributionStatus;

// 6. System Integrity
exports.syncSystemStructure = systemIntegrity.syncSystemStructure;
exports.runSecurityAudit = systemIntegrity.runSecurityAudit;
exports.getSignedUploadUrl = require('./storageSecure').getSignedUploadUrl;

// NEW: Email Testing
exports.testEmailConnection = require('./testEmailConnection').testEmailConnection;

// 7. Data Migration
exports.runMigration = companyAdmin.runMigration;

// 8. Global Search - REMOVED: Moved to frontend parallel Firestore queries

// 9. Scheduled Jobs
const customJobs = require('./customJobs');
exports.debugAppCounts = customJobs.debugAppCounts;

// 10. Integrations
const facebook = require('./integrations/facebook');
const smsIntegrations = require('./integrations/index');

exports.connectFacebookPage = facebook.connectFacebookPage;
exports.facebookWebhook = facebook.facebookWebhook;
exports.facebookWebhookV1 = facebook.facebookWebhookV1; // V1 version - public by default
exports.saveIntegrationConfig = smsIntegrations.saveIntegrationConfig;
exports.verifySmsConfig = smsIntegrations.verifySmsConfig; // Added missing export
exports.sendTestSMS = smsIntegrations.sendTestSMS;
exports.sendSMS = smsIntegrations.sendSMS; // NEW: Real Outbound
exports.executeReactivationBatch = smsIntegrations.executeReactivationBatch;
// REMOVED: assignPhoneNumber - now handled via direct Firestore updateDoc

// Digital Wallet
exports.addPhoneLine = smsIntegrations.addPhoneLine;
exports.removePhoneLine = smsIntegrations.removePhoneLine;

exports.testLineConnection = smsIntegrations.testLineConnection;
exports.verifyLineConnection = smsIntegrations.verifyLineConnection;


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

// 14. Engagement Engine (Smart Segments & Compliance)
const segments = require('./segments');
const blacklist = require('./blacklist');

exports.onApplicationUpdateSegments = segments.onApplicationUpdateSegments;
exports.onApplicationCreatedSegments = segments.onApplicationCreatedSegments;
exports.handleOptOut = blacklist.handleOptOut;