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
exports.backfillSmsSentPhones = bulkActions.backfillSmsSentPhones;
exports.checkImportPhones = bulkActions.checkImportPhones;




// --- IMPORT MODULES ---
const driverSync = require('./driverSync');
const hrAdmin = require('./hrAdmin');
const companyAdmin = require('./companyAdmin');

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

// 2b. User Onboarding (New)
exports.onDriverProfileCreated = require('./userOnboarding').onDriverProfileCreated;

// 3. Company Admin
exports.joinCompanyTeam = hrAdmin.joinCompanyTeam;
exports.deleteCompany = companyAdmin.deleteCompany;
exports.syncPublicProfile = companyAdmin.syncPublicProfile;

// 4. Applications & Driver Sync
exports.onApplicationSubmitted = driverSync.onApplicationSubmitted;
exports.onApplicationUpdated = driverSync.onApplicationUpdated;  // NEW: Sync files on update
exports.onLeadSubmitted = driverSync.onLeadSubmitted;
exports.syncDriverOnLog = driverSync.syncDriverOnLog;
exports.syncDriverOnActivity = driverSync.syncDriverOnActivity;
exports.onCompanyLeadSubmitted = driverSync.onCompanyLeadSubmitted;

// 4b. Guest Application Submission (Admin SDK — bypasses rules)
exports.submitGuestApplication = require('./guestApplication').submitGuestApplication;

exports.sendAutomatedEmail = companyAdmin.sendAutomatedEmail;




// 6. System Integrity
exports.syncSystemStructure = systemIntegrity.syncSystemStructure;
exports.runSecurityAudit = systemIntegrity.runSecurityAudit;
exports.getSignedUploadUrl = require('./storageSecure').getSignedUploadUrl;

// NEW: Email Testing
exports.testEmailConnection = require('./testEmailConnection').testEmailConnection;

// 7. Data Migration
exports.runMigration = companyAdmin.runMigration;
exports.backfillPublicProfiles = companyAdmin.backfillPublicProfiles;
exports.backfillEmployerFields = require('./backfillEmployerFields').backfillEmployerFields;



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


// Digital Wallet
exports.addPhoneLine = smsIntegrations.addPhoneLine;
exports.removePhoneLine = smsIntegrations.removePhoneLine;

exports.testLineConnection = smsIntegrations.testLineConnection;
exports.verifyLineConnection = smsIntegrations.verifyLineConnection;


// 11. Stats Aggregation
exports.onActivityLogCreated = statsAggregator.onActivityLogCreated;
exports.onLegacyActivityCreated = statsAggregator.onLegacyActivityCreated;
exports.onLeadsActivityLogCreated = statsAggregator.onLeadsActivityLogCreated; // NEW: Leads trigger



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

// 15. In-App Notifications
const notificationTriggers = require('./notificationTriggers');
exports.onApplicationStatusChanged = notificationTriggers.onApplicationStatusChanged;
exports.onLeadAssigned = notificationTriggers.onLeadAssigned;
exports.onNewApplicationNotification = notificationTriggers.onNewApplicationNotification;
exports.onCallbackScheduled = notificationTriggers.onCallbackScheduled;
exports.onLeadCallbackScheduled = notificationTriggers.onLeadCallbackScheduled;

// 16. Pipeline Tracking
const pipelineTriggers = require('./pipelineTriggers');
exports.onPipelineEntryWrite = pipelineTriggers.onPipelineEntryWrite;

// 17. Employment Verification (PEV Portal)
const employmentVerification = require('./employmentVerification');
exports.sendVerificationRequest = employmentVerification.sendVerificationRequest;
exports.getVerificationRequest = employmentVerification.getVerificationRequest;
exports.submitVerificationResponse = employmentVerification.submitVerificationResponse;
exports.trackVerificationOpen = employmentVerification.trackVerificationOpen;
exports.processVerificationReminders = employmentVerification.processVerificationReminders;