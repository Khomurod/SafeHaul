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
exports.backfillAllSmsSentPhones = bulkActions.backfillAllSmsSentPhones;
exports.checkImportPhones = bulkActions.checkImportPhones;




// --- IMPORT MODULES ---
const driverSync = require('./driverSync');
const hrAdmin = require('./hrAdmin');
const companyAdmin = require('./companyAdmin');
const legacyCompat = require('./legacyCompat');

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
// ESIGN-9 FIX: Nightly cleanup of orphaned signature PNG files after sealing
exports.cleanupOrphanedSignatures = digitalSealing.cleanupOrphanedSignatures;
// FEAT-3: SMS notification for signing requests
const notifySignerSMS = require('./notifySignerSMS');
exports.notifySignerSMS = notifySignerSMS.notifySignerSMS;
// ADV-1 FIX: Secure callable to retrieve full signing link (with token from secrets)
const getSigningLink = require('./getSigningLink');
exports.getSigningLink = getSigningLink.getSigningLink;

// 2. Auth & User Management
exports.createPortalUser = hrAdmin.createPortalUser;
exports.deletePortalUser = hrAdmin.deletePortalUser;
exports.updatePortalUser = hrAdmin.updatePortalUser;
exports.onMembershipWrite = hrAdmin.onMembershipWrite;

// 2b. User Onboarding (New)
exports.onDriverProfileCreated = require('./userOnboarding').onDriverProfileCreated;

// 2c. SEC-002: one-time backfill of users/{uid}.companyIds from memberships.
// Must be run (LIVE) before deploying the SEC-002 Firestore rules so existing
// same-company teammate reads keep working. Super-admin only.
exports.backfillUserCompanyIds = require('./backfillUserCompanyIds').backfillUserCompanyIds;

// 2d. SEC-002 follow-up: backfill drivers/{id}.companyIds from existing
// applications/leads so same-company staff can read connected driver profiles.
// Forward population is handled by driverSync; this seeds pre-existing drivers.
exports.backfillDriverCompanyIds = require('./backfillDriverCompanyIds').backfillDriverCompanyIds;

// 3. Company Admin
exports.deleteCompany = companyAdmin.deleteCompany;
exports.syncPublicProfile = companyAdmin.syncPublicProfile;
// Company-admin hard delete of an application/lead (cascade + storage cleanup)
exports.deleteApplication = require('./deleteApplication').deleteApplication;

// Company edits → pending driver-approved changes (+ token review portal)
const applicationChanges = require('./applicationChanges');
exports.proposeApplicationChanges = applicationChanges.proposeApplicationChanges;
exports.createChangeReview = applicationChanges.createChangeReview;
exports.getChangeReview = applicationChanges.getChangeReview;
exports.submitChangeResolution = applicationChanges.submitChangeResolution;

// 4a. Employer dashboard counter rollups (internal_stats — server writes only)
const dashboardStatsRollup = require('./dashboardStatsRollup');
exports.onApplicationWrittenDashboardRollup = dashboardStatsRollup.onApplicationWrittenDashboardRollup;
exports.onLeadWrittenDashboardRollup = dashboardStatsRollup.onLeadWrittenDashboardRollup;
exports.reconcileCompanyDashboardStats = dashboardStatsRollup.reconcileCompanyDashboardStats;

// 4. Applications & Driver Sync
exports.onApplicationSubmitted = driverSync.onApplicationSubmitted;
exports.onApplicationUpdated = driverSync.onApplicationUpdated;  // NEW: Sync files on update
exports.syncDriverOnLog = driverSync.syncDriverOnLog;
exports.syncDriverOnActivity = driverSync.syncDriverOnActivity;
exports.onCompanyLeadSubmitted = driverSync.onCompanyLeadSubmitted;

// 4c. ATS automated SMS on contact-attempt transitions
const atsContactSms = require('./atsContactSms');
exports.onApplicationAtsContactSms = atsContactSms.onApplicationAtsContactSms;
exports.onLeadAtsContactSms = atsContactSms.onLeadAtsContactSms;

// 4b. Guest Application Submission (Admin SDK — bypasses rules)
exports.submitGuestApplication = require('./guestApplication').submitGuestApplication;
exports.parseCdlWithGroq = require('./cdlParser').parseCdlWithGroq;
exports.createPostApplicationSigningRequest = require('./postApplicationEdocs').createPostApplicationSigningRequest;
// AI Field Assistant: authenticated, company-scoped PDF field-placement suggestions.
// Deliberately separate from parseCdlWithGroq (public guest path, different model pin).
exports.analyzeEdocFieldPlacement = require('./edocFieldPlacement').analyzeEdocFieldPlacement;
exports.backfillApplicationSearchFields = require('./searchFieldsBackfill').backfillApplicationSearchFields;

// 4d. Sandbox applications (Super Admin maintenance)
const sandboxApplication = require('./sandboxApplication');
exports.listSandboxTenantCompanies = sandboxApplication.listSandboxTenantCompanies;
exports.deleteSandboxApplication = sandboxApplication.deleteSandboxApplication;
exports.transferSandboxApplication = sandboxApplication.transferSandboxApplication;

exports.sendAutomatedEmail = companyAdmin.sendAutomatedEmail;




// 6. System Integrity
exports.syncSystemStructure = systemIntegrity.syncSystemStructure;
exports.runSecurityAudit = systemIntegrity.runSecurityAudit;
exports.getSignedUploadUrl = require('./storageSecure').getSignedUploadUrl;
exports.getSignedGuestUploadUrl = require('./getSignedGuestUploadUrl').getSignedGuestUploadUrl;

// NEW: Email Testing
exports.testEmailConnection = require('./testEmailConnection').testEmailConnection;

// CONN-1/CONN-4 FIX: Server-side save with password stored in admin-only subcollection
exports.saveEmailSettings = require('./saveEmailSettings').saveEmailSettings;

// REFACTOR: Sanitized callable for Email Settings UI — never returns smtpPass
exports.getEmailSettingsMeta = require('./getEmailSettingsMeta').getEmailSettingsMeta;

// MIGRATION: One-time migration of email settings from root doc to admin-only subcollection
exports.migrateEmailSettings = require('./migrateEmailSettings').migrateEmailSettings;

// 7. Data Migration
exports.runMigration = companyAdmin.runMigration;
exports.backfillPublicProfiles = companyAdmin.backfillPublicProfiles;



// 9. Scheduled Jobs (Removed)

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
exports.saveSmsLineAssignments = smsIntegrations.saveSmsLineAssignments;


// 11. Stats Aggregation
exports.onActivityLogCreated = statsAggregator.onActivityLogCreated;
exports.onLegacyActivityCreated = statsAggregator.onLegacyActivityCreated;
exports.onLeadsActivityLogCreated = statsAggregator.onLeadsActivityLogCreated; // NEW: Leads trigger
exports.onLeadsLegacyActivityCreated = statsAggregator.onLeadsLegacyActivityCreated; // NEW: Leads legacy trigger

// 12. Activity-log retention (B2): stamp expiresAt for the eventual TTL policy.
const activityLogRetention = require('./activityLogRetention');
exports.stampActivityLogExpiry = activityLogRetention.stampActivityLogExpiry;
exports.stampLegacyActivityExpiry = activityLogRetention.stampLegacyActivityExpiry;

// 13. Stats Backfill (Admin Tools)
// CALL-3 FIX: These functions are called by StatsBackfillPanel.jsx and were previously missing.
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
// DL-4 FIX: Send confirmation email to applicant on every new application
exports.onNewApplicationEmailConfirmation = notificationTriggers.onNewApplicationEmailConfirmation;

// 17. Employment Verification (PEV Portal)
const employmentVerification = require('./employmentVerification');
exports.sendVerificationRequest = employmentVerification.sendVerificationRequest;
exports.getVerificationRequest = employmentVerification.getVerificationRequest;
exports.submitVerificationResponse = employmentVerification.submitVerificationResponse;
exports.trackVerificationOpen = employmentVerification.trackVerificationOpen;
exports.processVerificationReminders = employmentVerification.processVerificationReminders;
// PEV-BRK-3 companion: On-demand signed URL generation for PEV result PDFs
exports.getSignedPevUrl = require('./getSignedPevUrl').getSignedPevUrl;
// Signed download URLs for secure_documents (e-signature envelopes)
exports.getSignedDocumentUrl = require('./getSignedDocumentUrl').getSignedDocumentUrl;

// Signed download URLs for driver-uploaded application files (guest_uploads): re-signs
// at view time so company users can open CDLs/medical cards (the persisted URL expires).
exports.getSignedApplicationFileUrl = require('./getSignedApplicationFileUrl').getSignedApplicationFileUrl;

// 18. Feature Scheduler
const featureScheduler = require('./featureScheduler');
exports.enforceFeatureSchedules = featureScheduler.enforceFeatureSchedules;

// 20. Super Admin Environment & Integrations vault.
// Six narrow callables over the frozen configuration registry. Every one of
// them requires exactly globalRole === 'super_admin', reveals or mutates a
// single entry, and writes a value-free audit record. There is no generic
// environment-variable endpoint. See functions/environmentVault/index.js.
const environmentVault = require('./environmentVault');
exports.listEnvironmentAndIntegrations = environmentVault.listEnvironmentAndIntegrations;
exports.revealEnvironmentValue = environmentVault.revealEnvironmentValue;
exports.updateEnvironmentValue = environmentVault.updateEnvironmentValue;
exports.addEnvironmentValue = environmentVault.addEnvironmentValue;
exports.deleteEnvironmentValue = environmentVault.deleteEnvironmentValue;
exports.testManagedIntegration = environmentVault.testManagedIntegration;

// 19. Legacy Compatibility Callables (frontend contract preservation)
exports.updateBulkSessionStatus = legacyCompat.updateBulkSessionStatus;
exports.backfillEmployerFields = legacyCompat.backfillEmployerFields;
