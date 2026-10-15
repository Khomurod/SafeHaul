// Every function starts on the shared Admin app and its Firestore settings
// (`ignoreUndefinedProperties`), whichever module it goes on to load.
require('./firebaseAdmin');

// In Cloud every function runs in its own instance, and the runtime names the
// export it calls in FUNCTION_TARGET. That function loads its own module only:
// a cold start then reads a fraction of the code. With no name (the deploy, the
// emulator's discovery, tests) everything loads, and so it does for a name this
// file does not export.
const functionTarget = process.env.FUNCTION_TARGET || '';

function exportFunctions(wanted) {
  // Bulk Actions (Resilient session-based)
  // Note: pause/resume/cancel moved to frontend direct Firestore writes
  if (wanted('initBulkSession')) exports.initBulkSession = require('./bulkActions').initBulkSession;
  if (wanted('processBulkBatch')) exports.processBulkBatch = require('./bulkActions').processBulkBatch;
  if (wanted('retryFailedAttempts')) exports.retryFailedAttempts = require('./bulkActions').retryFailedAttempts;
  if (wanted('getFilterCount')) exports.getFilterCount = require('./bulkActions').getFilterCount;
  if (wanted('getFilteredLeadsPage')) exports.getFilteredLeadsPage = require('./bulkActions').getFilteredLeadsPage;
  if (wanted('resumeBulkSession')) exports.resumeBulkSession = require('./bulkActions').resumeBulkSession;
  if (wanted('pauseBulkSession')) exports.pauseBulkSession = require('./bulkActions').pauseBulkSession;
  if (wanted('cancelBulkSession')) exports.cancelBulkSession = require('./bulkActions').cancelBulkSession;
  if (wanted('backfillSmsSentPhones')) exports.backfillSmsSentPhones = require('./bulkActions').backfillSmsSentPhones;
  if (wanted('backfillAllSmsSentPhones')) exports.backfillAllSmsSentPhones = require('./bulkActions').backfillAllSmsSentPhones;
  if (wanted('checkImportPhones')) exports.checkImportPhones = require('./bulkActions').checkImportPhones;
  if (wanted('deleteBulkSessionData')) exports.deleteBulkSessionData = require('./bulkActions').deleteBulkSessionData;

  // 1. Docs & Email & Public Signing
  if (wanted('sealDocument')) exports.sealDocument = require('./digitalSealing').sealDocument;
  if (wanted('notifySigner')) exports.notifySigner = require('./notifySigner').notifySigner;
  if (wanted('getPublicEnvelope')) exports.getPublicEnvelope = require('./publicSigning').getPublicEnvelope;
  if (wanted('submitPublicEnvelope')) exports.submitPublicEnvelope = require('./publicSigning').submitPublicEnvelope;
  // ESIGN-9 FIX: Nightly cleanup of orphaned signature PNG files after sealing
  if (wanted('cleanupOrphanedSignatures')) exports.cleanupOrphanedSignatures = require('./digitalSealing').cleanupOrphanedSignatures;
  // FEAT-3: SMS notification for signing requests
  if (wanted('notifySignerSMS')) exports.notifySignerSMS = require('./notifySignerSMS').notifySignerSMS;
  // A correction to the signer's email or phone sends a new link there
  if (wanted('resendSignerOnCorrection')) exports.resendSignerOnCorrection = require('./resendSignerOnCorrection').resendSignerOnCorrection;
  // ADV-1 FIX: Secure callable to retrieve full signing link (with token from secrets)
  if (wanted('getSigningLink')) exports.getSigningLink = require('./getSigningLink').getSigningLink;

  // 2. Auth & User Management
  if (wanted('createPortalUser')) exports.createPortalUser = require('./hrAdmin').createPortalUser;
  if (wanted('deletePortalUser')) exports.deletePortalUser = require('./hrAdmin').deletePortalUser;
  if (wanted('updatePortalUser')) exports.updatePortalUser = require('./hrAdmin').updatePortalUser;
  if (wanted('onMembershipWrite')) exports.onMembershipWrite = require('./hrAdmin').onMembershipWrite;
  if (wanted('onCompanyActivationChange')) exports.onCompanyActivationChange = require('./hrAdmin').onCompanyActivationChange;
  if (wanted('reconcileCompanyClaims')) exports.reconcileCompanyClaims = require('./hrAdmin').reconcileCompanyClaims;
  // Authoritative team roster: resolves each membership to a real name/email using
  // the Admin SDK + Firebase Auth as fallback, and reports missing/stale/orphaned/
  // duplicate records explicitly instead of as unknown users.
  if (wanted('listCompanyTeam')) exports.listCompanyTeam = require('./hrAdmin').listCompanyTeam;

  // 2b. User Onboarding (New)
  if (wanted('onDriverProfileCreated')) exports.onDriverProfileCreated = require('./userOnboarding').onDriverProfileCreated;

  // 2c. SEC-002: one-time backfill of users/{uid}.companyIds from memberships.
  // Must be run (LIVE) before deploying the SEC-002 Firestore rules so existing
  // same-company teammate reads keep working. Super-admin only.
  if (wanted('backfillUserCompanyIds')) exports.backfillUserCompanyIds = require('./backfillUserCompanyIds').backfillUserCompanyIds;

  // 2d. SEC-002 follow-up: backfill drivers/{id}.companyIds from existing
  // applications/leads so same-company staff can read connected driver profiles.
  // Forward population is handled by driverSync; this seeds pre-existing drivers.
  if (wanted('backfillDriverCompanyIds')) exports.backfillDriverCompanyIds = require('./backfillDriverCompanyIds').backfillDriverCompanyIds;

  // 3. Company Admin
  if (wanted('deleteCompany')) exports.deleteCompany = require('./companyAdmin').deleteCompany;
  if (wanted('syncPublicProfile')) exports.syncPublicProfile = require('./companyAdmin').syncPublicProfile;
  // Company-admin hard delete of an application/lead (cascade + storage cleanup)
  if (wanted('deleteApplication')) exports.deleteApplication = require('./deleteApplication').deleteApplication;

  // Company edits → pending driver-approved changes (+ token review portal)
  if (wanted('proposeApplicationChanges')) exports.proposeApplicationChanges = require('./applicationChanges').proposeApplicationChanges;
  if (wanted('createChangeReview')) exports.createChangeReview = require('./applicationChanges').createChangeReview;
  if (wanted('getChangeReview')) exports.getChangeReview = require('./applicationChanges').getChangeReview;
  if (wanted('submitChangeResolution')) exports.submitChangeResolution = require('./applicationChanges').submitChangeResolution;

  // 4a. Employer dashboard counter rollups (internal_stats — server writes only)
  if (wanted('onApplicationWrittenDashboardRollup')) exports.onApplicationWrittenDashboardRollup = require('./dashboardStatsRollup').onApplicationWrittenDashboardRollup;
  if (wanted('onLeadWrittenDashboardRollup')) exports.onLeadWrittenDashboardRollup = require('./dashboardStatsRollup').onLeadWrittenDashboardRollup;
  if (wanted('reconcileCompanyDashboardStats')) exports.reconcileCompanyDashboardStats = require('./dashboardStatsRollup').reconcileCompanyDashboardStats;

  // 4. Applications & Driver Sync
  if (wanted('onApplicationSubmitted')) exports.onApplicationSubmitted = require('./driverSync').onApplicationSubmitted;
  if (wanted('onApplicationUpdated')) exports.onApplicationUpdated = require('./driverSync').onApplicationUpdated;  // NEW: Sync files on update
  if (wanted('syncDriverOnLog')) exports.syncDriverOnLog = require('./driverSync').syncDriverOnLog;
  if (wanted('syncDriverOnActivity')) exports.syncDriverOnActivity = require('./driverSync').syncDriverOnActivity;
  if (wanted('onCompanyLeadSubmitted')) exports.onCompanyLeadSubmitted = require('./driverSync').onCompanyLeadSubmitted;

  // 4c. ATS automated SMS on contact-attempt transitions
  if (wanted('onApplicationAtsContactSms')) exports.onApplicationAtsContactSms = require('./atsContactSms').onApplicationAtsContactSms;
  if (wanted('onLeadAtsContactSms')) exports.onLeadAtsContactSms = require('./atsContactSms').onLeadAtsContactSms;

  // 4b. Guest Application Submission (Admin SDK — bypasses rules)
  if (wanted('submitGuestApplication')) exports.submitGuestApplication = require('./guestApplication').submitGuestApplication;
  // Serves the legal agreements the apply page displays, from the same registry
  // that freezes them into the submission snapshot, so displayed and preserved
  // wording cannot diverge.
  if (wanted('getApplicationAgreements')) exports.getApplicationAgreements = require('./applicationAgreements').getApplicationAgreements;
  // Company-specific legal wording, versioned; read by company admins, changed by super admins only.
  if (wanted('listCompanyAgreementWording')) exports.listCompanyAgreementWording = require('./companyAgreements').listCompanyAgreementWording;
  if (wanted('publishCompanyAgreementWording')) exports.publishCompanyAgreementWording = require('./companyAgreements').publishCompanyAgreementWording;
  if (wanted('revertCompanyAgreementWording')) exports.revertCompanyAgreementWording = require('./companyAgreements').revertCompanyAgreementWording;
  if (wanted('parseCdlWithGroq')) exports.parseCdlWithGroq = require('./cdlParser').parseCdlWithGroq;
  // Optional, company-enabled: an applicant's PSP report or MVR read into suggestions they confirm.
  if (wanted('extractApplicationReport')) exports.extractApplicationReport = require('./applicationReportImport').extractApplicationReport;
  // Autosave, resume and start-over for an in-progress application. Drafts live in
  // their own server-only subcollection rather than in `applications`, because
  // creating an application document fires the recruiter notification, the
  // applicant's "we received your application" email and the driver-profile sync —
  // none of which should happen when someone has filled in one page.
  if (wanted('saveApplicationProgress')) exports.saveApplicationProgress = require('./applicationDrafts').saveApplicationProgress;
  if (wanted('findResumableApplication')) exports.findResumableApplication = require('./applicationDrafts').findResumableApplication;
  if (wanted('resumeApplicationDraft')) exports.resumeApplicationDraft = require('./applicationDrafts').resumeApplicationDraft;
  if (wanted('startNewApplication')) exports.startNewApplication = require('./applicationDrafts').startNewApplication;
  // The recruiter half: unfinished applications are only useful to the carrier if
  // somebody can see them.
  if (wanted('listApplicationDrafts')) exports.listApplicationDrafts = require('./applicationDrafts').listApplicationDrafts;
  // A Company Admin reads any unfinished application, whoever started it, may
  // correct one the driver owns, and may delete one with its files, links and the
  // same driver's other drafts. Recruiters keep the narrower read in
  // `getCompanyPreparedDraft`.
  if (wanted('getApplicationDraft')) exports.getApplicationDraft = require('./applicationDrafts').getApplicationDraft;
  if (wanted('saveApplicationDraftEdits')) exports.saveApplicationDraftEdits = require('./applicationDrafts').saveApplicationDraftEdits;
  if (wanted('purgeApplicationDraft')) exports.purgeApplicationDraft = require('./applicationDrafts').purgeApplicationDraft;
  // An unfinished application that expires takes its uploads with it.
  if (wanted('deleteExpiredDraftFiles')) exports.deleteExpiredDraftFiles = require('./drafts/expired').deleteExpiredDraftFiles;

  // Applications a carrier starts on the driver's behalf: prepared as a draft,
  // completed and signed by the driver through the ordinary public wizard.
  if (wanted('saveCompanyPreparedApplication')) exports.saveCompanyPreparedApplication = require('./companyApplications').saveCompanyPreparedApplication;
  if (wanted('getCompanyPreparedDraft')) exports.getCompanyPreparedDraft = require('./companyApplications').getCompanyPreparedDraft;
  if (wanted('listCompanyPreparedApplications')) exports.listCompanyPreparedApplications = require('./companyApplications').listCompanyPreparedApplications;
  if (wanted('mintApplicationInvite')) exports.mintApplicationInvite = require('./companyApplications').mintApplicationInvite;
  if (wanted('exchangeApplicationInvite')) exports.exchangeApplicationInvite = require('./companyApplications').exchangeApplicationInvite;
  if (wanted('extractCompanyApplicationDocuments')) exports.extractCompanyApplicationDocuments = require('./companyApplications').extractCompanyApplicationDocuments;
  if (wanted('createPostApplicationSigningRequest')) exports.createPostApplicationSigningRequest = require('./postApplicationEdocs').createPostApplicationSigningRequest;
  // AI Field Assistant: authenticated, company-scoped PDF field-placement suggestions.
  // Deliberately separate from parseCdlWithGroq (public guest path, different model pin).
  if (wanted('analyzeEdocFieldPlacement')) exports.analyzeEdocFieldPlacement = require('./edocFieldPlacement').analyzeEdocFieldPlacement;
  if (wanted('backfillApplicationSearchFields')) exports.backfillApplicationSearchFields = require('./searchFieldsBackfill').backfillApplicationSearchFields;
  // Gives applications submitted before preservation a preserved record and PDF,
  // built only from evidence that survives, and marked as reconstructed.
  if (wanted('reconstructHistoricalApplications')) exports.reconstructHistoricalApplications = require('./reconstructHistoricalApplications').reconstructHistoricalApplications;
  // Read-only: counts how much historical reconstruction is actually outstanding,
  // independently of the migration that writes it. The temporary Super Admin action
  // reads its count from here rather than carrying a hard-coded total, and retires
  // itself when this reports the work verified complete.
  if (wanted('surveyHistoricalReconstruction')) exports.surveyHistoricalReconstruction = require('./historicalReconstructionSurvey').surveyHistoricalReconstruction;

  // 4d. Sandbox applications (Super Admin maintenance)
  if (wanted('listSandboxTenantCompanies')) exports.listSandboxTenantCompanies = require('./sandboxApplication').listSandboxTenantCompanies;
  if (wanted('deleteSandboxApplication')) exports.deleteSandboxApplication = require('./sandboxApplication').deleteSandboxApplication;
  if (wanted('transferSandboxApplication')) exports.transferSandboxApplication = require('./sandboxApplication').transferSandboxApplication;

  if (wanted('sendAutomatedEmail')) exports.sendAutomatedEmail = require('./companyAdmin').sendAutomatedEmail;

  // 6. System Integrity
  if (wanted('syncSystemStructure')) exports.syncSystemStructure = require('./systemIntegrity').syncSystemStructure;
  if (wanted('runSecurityAudit')) exports.runSecurityAudit = require('./systemIntegrity').runSecurityAudit;
  if (wanted('getSignedUploadUrl')) exports.getSignedUploadUrl = require('./storageSecure').getSignedUploadUrl;
  if (wanted('getSignedGuestUploadUrl')) exports.getSignedGuestUploadUrl = require('./getSignedGuestUploadUrl').getSignedGuestUploadUrl;

  // NEW: Email Testing
  if (wanted('testEmailConnection')) exports.testEmailConnection = require('./testEmailConnection').testEmailConnection;

  // CONN-1/CONN-4 FIX: Server-side save with password stored in admin-only subcollection
  if (wanted('saveEmailSettings')) exports.saveEmailSettings = require('./saveEmailSettings').saveEmailSettings;

  // REFACTOR: Sanitized callable for Email Settings UI — never returns smtpPass
  if (wanted('getEmailSettingsMeta')) exports.getEmailSettingsMeta = require('./getEmailSettingsMeta').getEmailSettingsMeta;

  // MIGRATION: One-time migration of email settings from root doc to admin-only subcollection
  if (wanted('migrateEmailSettings')) exports.migrateEmailSettings = require('./migrateEmailSettings').migrateEmailSettings;

  if (wanted('backfillPublicProfiles')) exports.backfillPublicProfiles = require('./companyAdmin').backfillPublicProfiles;
  // Hourly reconciler: rewrites public profiles left behind by a change to the
  // projection itself, which the onWrite trigger alone can never reach.
  if (wanted('reconcilePublicProfilesSchedule')) exports.reconcilePublicProfilesSchedule = require('./companyAdmin').reconcilePublicProfilesSchedule;

  // 9. Scheduled Jobs (Removed)

  // 10. Integrations

  if (wanted('connectFacebookPage')) exports.connectFacebookPage = require('./integrations/facebook').connectFacebookPage;
  if (wanted('facebookWebhook')) exports.facebookWebhook = require('./integrations/facebook').facebookWebhook;
  if (wanted('facebookWebhookV1')) exports.facebookWebhookV1 = require('./integrations/facebook').facebookWebhookV1; // V1 version - public by default
  if (wanted('saveIntegrationConfig')) exports.saveIntegrationConfig = require('./integrations/index').saveIntegrationConfig;
  if (wanted('verifySmsConfig')) exports.verifySmsConfig = require('./integrations/index').verifySmsConfig; // Added missing export
  if (wanted('sendTestSMS')) exports.sendTestSMS = require('./integrations/index').sendTestSMS;
  if (wanted('sendSMS')) exports.sendSMS = require('./integrations/index').sendSMS; // NEW: Real Outbound
  if (wanted('executeReactivationBatch')) exports.executeReactivationBatch = require('./integrations/index').executeReactivationBatch;

  // Digital Wallet
  if (wanted('addPhoneLine')) exports.addPhoneLine = require('./integrations/index').addPhoneLine;
  if (wanted('removePhoneLine')) exports.removePhoneLine = require('./integrations/index').removePhoneLine;

  if (wanted('testLineConnection')) exports.testLineConnection = require('./integrations/index').testLineConnection;
  if (wanted('verifyLineConnection')) exports.verifyLineConnection = require('./integrations/index').verifyLineConnection;
  if (wanted('saveSmsLineAssignments')) exports.saveSmsLineAssignments = require('./integrations/index').saveSmsLineAssignments;

  // 11. Stats Aggregation
  if (wanted('onActivityLogCreated')) exports.onActivityLogCreated = require('./statsAggregator').onActivityLogCreated;
  if (wanted('onLegacyActivityCreated')) exports.onLegacyActivityCreated = require('./statsAggregator').onLegacyActivityCreated;
  if (wanted('onLeadsActivityLogCreated')) exports.onLeadsActivityLogCreated = require('./statsAggregator').onLeadsActivityLogCreated; // NEW: Leads trigger
  if (wanted('onLeadsLegacyActivityCreated')) exports.onLeadsLegacyActivityCreated = require('./statsAggregator').onLeadsLegacyActivityCreated; // NEW: Leads legacy trigger

  // 12. Activity-log retention (B2): stamp expiresAt for the eventual TTL policy.
  if (wanted('stampActivityLogExpiry')) exports.stampActivityLogExpiry = require('./activityLogRetention').stampActivityLogExpiry;
  if (wanted('stampLegacyActivityExpiry')) exports.stampLegacyActivityExpiry = require('./activityLogRetention').stampLegacyActivityExpiry;

  // 13. Stats Backfill (Admin Tools)
  // CALL-3 FIX: These functions are called by StatsBackfillPanel.jsx and were previously missing.
  if (wanted('backfillCompanyStats')) exports.backfillCompanyStats = require('./statsBackfill').backfillCompanyStats;
  if (wanted('backfillAllStats')) exports.backfillAllStats = require('./statsBackfill').backfillAllStats;

  // 14. Compliance (SMS opt-out)

  if (wanted('handleOptOut')) exports.handleOptOut = require('./blacklist').handleOptOut;

  // 15. In-App Notifications
  if (wanted('onApplicationStatusChanged')) exports.onApplicationStatusChanged = require('./notificationTriggers').onApplicationStatusChanged;
  if (wanted('onLeadAssigned')) exports.onLeadAssigned = require('./notificationTriggers').onLeadAssigned;
  if (wanted('onNewApplicationNotification')) exports.onNewApplicationNotification = require('./notificationTriggers').onNewApplicationNotification;
  if (wanted('onCallbackScheduled')) exports.onCallbackScheduled = require('./notificationTriggers').onCallbackScheduled;
  if (wanted('onLeadCallbackScheduled')) exports.onLeadCallbackScheduled = require('./notificationTriggers').onLeadCallbackScheduled;
  // DL-4 FIX: Send confirmation email to applicant on every new application
  if (wanted('onNewApplicationEmailConfirmation')) exports.onNewApplicationEmailConfirmation = require('./notificationTriggers').onNewApplicationEmailConfirmation;

  // 17. Employment Verification (PEV Portal)
  if (wanted('sendVerificationRequest')) exports.sendVerificationRequest = require('./employmentVerification').sendVerificationRequest;
  if (wanted('getVerificationRequest')) exports.getVerificationRequest = require('./employmentVerification').getVerificationRequest;
  if (wanted('submitVerificationResponse')) exports.submitVerificationResponse = require('./employmentVerification').submitVerificationResponse;
  if (wanted('processVerificationReminders')) exports.processVerificationReminders = require('./employmentVerification').processVerificationReminders;
  // PEV-BRK-3 companion: On-demand signed URL generation for PEV result PDFs
  if (wanted('getSignedPevUrl')) exports.getSignedPevUrl = require('./getSignedPevUrl').getSignedPevUrl;
  // Signed download URLs for secure_documents (e-signature envelopes)
  if (wanted('getSignedDocumentUrl')) exports.getSignedDocumentUrl = require('./getSignedDocumentUrl').getSignedDocumentUrl;

  // Signed download URLs for driver-uploaded application files (guest_uploads): re-signs
  // at view time so company users can open CDLs/medical cards (the persisted URL expires).
  if (wanted('getSignedApplicationFileUrl')) exports.getSignedApplicationFileUrl = require('./getSignedApplicationFileUrl').getSignedApplicationFileUrl;
  // The ONLY way to read a preserved original application PDF. Authorizes the
  // caller and writes an audit record before issuing a short-lived signed URL.
  if (wanted('getApplicationOriginalPdfUrl')) exports.getApplicationOriginalPdfUrl = require('./applicationOriginalPdf').getApplicationOriginalPdfUrl;

  // Super Admin → Website Leads. Reads the archive of leads captured by the
  // removed marketing site's contact form.
  //
  // SIX CALLABLES WERE REMOVED HERE, and their names are worth keeping in the
  // history: submitLandingLead (capture), getLandingPageSettings,
  // updateLandingTelegramConfig, setLandingTelegramEnabled, sendLandingTelegramTest
  // and retryLandingLeadDelivery. The marketing site is gone and lead capture,
  // Telegram delivery, configuration, test-send and retry are retired by owner
  // decision. The LEADS were kept, so the one that reads them survives. Any rebuilt
  // capture is to be built fresh rather than restored from what is left.
  if (wanted('listLandingLeads')) exports.listLandingLeads = require('./landing/callables').listLandingLeads;

  // 18. Feature Scheduler
  if (wanted('enforceFeatureSchedules')) exports.enforceFeatureSchedules = require('./featureScheduler').enforceFeatureSchedules;

  // 20. Super Admin Environment & Integrations vault.
  // Six narrow callables over the frozen configuration registry. Every one of
  // them requires exactly globalRole === 'super_admin', reveals or mutates a
  // single entry, and writes a value-free audit record. There is no generic
  // environment-variable endpoint. See functions/environmentVault/index.js.
  if (wanted('listEnvironmentAndIntegrations')) exports.listEnvironmentAndIntegrations = require('./environmentVault').listEnvironmentAndIntegrations;
  if (wanted('revealEnvironmentValue')) exports.revealEnvironmentValue = require('./environmentVault').revealEnvironmentValue;
  if (wanted('updateEnvironmentValue')) exports.updateEnvironmentValue = require('./environmentVault').updateEnvironmentValue;
  if (wanted('addEnvironmentValue')) exports.addEnvironmentValue = require('./environmentVault').addEnvironmentValue;
  if (wanted('deleteEnvironmentValue')) exports.deleteEnvironmentValue = require('./environmentVault').deleteEnvironmentValue;
  if (wanted('testManagedIntegration')) exports.testManagedIntegration = require('./environmentVault').testManagedIntegration;

  // 21. AI Integrations (Super Admin)
  // Manages credentials and settings for the shared AI provider platform. Reuses
  // the environment vault's guards and audit trail, so the same exact-role,
  // recent-authentication, rate-limit and value-free-audit rules apply. Provider
  // ids are resolved through the frozen registry in functions/ai/registry, so a
  // browser can never name an arbitrary Secret Manager resource.
  if (wanted('listAiProviders')) exports.listAiProviders = require('./ai/callables').listAiProviders;
  if (wanted('listAiTelemetry')) exports.listAiTelemetry = require('./ai/callables').listAiTelemetry;
  if (wanted('revealAiCredential')) exports.revealAiCredential = require('./ai/callables').revealAiCredential;
  if (wanted('saveAiCredential')) exports.saveAiCredential = require('./ai/callables').saveAiCredential;
  if (wanted('deleteAiCredential')) exports.deleteAiCredential = require('./ai/callables').deleteAiCredential;
  if (wanted('setAiProviderEnabled')) exports.setAiProviderEnabled = require('./ai/callables').setAiProviderEnabled;
  if (wanted('setAiProviderPriority')) exports.setAiProviderPriority = require('./ai/callables').setAiProviderPriority;
  if (wanted('updateAiProviderConfig')) exports.updateAiProviderConfig = require('./ai/callables').updateAiProviderConfig;
  if (wanted('testAiProvider')) exports.testAiProvider = require('./ai/callables').testAiProvider;
  if (wanted('diagnoseAiModelPins')) exports.diagnoseAiModelPins = require('./ai/callables').diagnoseAiModelPins;
  if (wanted('getAiModelVersions')) exports.getAiModelVersions = require('./ai/callables').getAiModelVersions;
  if (wanted('checkAiModelVersionsNow')) exports.checkAiModelVersionsNow = require('./ai/callables').checkAiModelVersionsNow;
  if (wanted('setAiModelAutoSelect')) exports.setAiModelAutoSelect = require('./ai/callables').setAiModelAutoSelect;
  if (wanted('resetAiModelLists')) exports.resetAiModelLists = require('./ai/callables').resetAiModelLists;
  if (wanted('migrateGroqCredential')) exports.migrateGroqCredential = require('./ai/callables').migrateGroqCredential;
  // Credential access is diagnosed from BOTH Functions generations on purpose:
  // 1st gen defaults to the App Engine service account and 2nd gen to the Compute
  // Engine one, so a Secret Manager grant can fix some AI entry points and not
  // others. One answer proves nothing; the pair is the diagnosis. See
  // functions/ai/callablesV1.js.
  if (wanted('diagnoseAiCredentialAccess')) exports.diagnoseAiCredentialAccess = require('./ai/callables').diagnoseAiCredentialAccess;
  if (wanted('diagnoseAiCredentialAccessV1')) exports.diagnoseAiCredentialAccessV1 = require('./ai/callablesV1').diagnoseAiCredentialAccessV1;

  // 22. SafeHaul News & Insights
  // Public rendering is one onRequest handler behind Hosting rewrites, so /news,
  // /news/{slug}, the feed, the sitemap and the landing card endpoint share a
  // single ordering-obvious rewrite block. The scheduler runs hourly and, from
  // 07:00 Chicago, offers the day to one theme per run until its article publishes.
  if (wanted('serveBlogPublic')) exports.serveBlogPublic = require('./blog/publicApi').serveBlogPublic;

  if (wanted('publishScheduledBlogPosts')) exports.publishScheduledBlogPosts = require('./blog/scheduler').publishScheduledBlogPosts;

  if (wanted('listBlogPosts')) exports.listBlogPosts = require('./blog/callables').listBlogPosts;
  // The publication run ledger. `blog_posts` holds only the runs that succeeded,
  // so publication failure used to be rendered in the product as absence.
  if (wanted('listBlogRuns')) exports.listBlogRuns = require('./blog/callables').listBlogRuns;
  if (wanted('deleteBlogPost')) exports.deleteBlogPost = require('./blog/callables').deleteBlogPost;
  if (wanted('listMediaProviders')) exports.listMediaProviders = require('./blog/callables').listMediaProviders;
  if (wanted('saveMediaCredential')) exports.saveMediaCredential = require('./blog/callables').saveMediaCredential;
  if (wanted('deleteMediaCredential')) exports.deleteMediaCredential = require('./blog/callables').deleteMediaCredential;
  if (wanted('runBlogPublicationNow')) exports.runBlogPublicationNow = require('./blog/callables').runBlogPublicationNow;

  // 19. Legacy Compatibility Callables (frontend contract preservation)
  if (wanted('updateBulkSessionStatus')) exports.updateBulkSessionStatus = require('./legacyCompat').updateBulkSessionStatus;
  if (wanted('backfillEmployerFields')) exports.backfillEmployerFields = require('./legacyCompat').backfillEmployerFields;

  // 23. Super Admin Release Management
  // The only route by which a human changes what app.safehaul.io serves. A merge
  // to main still releases TESTING automatically and Production never
  // automatically; these callables are the deliberate step in between. They resolve
  // the release themselves from GitHub Deployment records — the browser never
  // names a commit — and dispatch the exact-version promotion workflow with a
  // GitHub App credential that never leaves the server.
  if (wanted('getReleaseStatus')) exports.getReleaseStatus = require('./releaseManagement').getReleaseStatus;
  if (wanted('promoteTestingToProduction')) exports.promoteTestingToProduction = require('./releaseManagement').promoteTestingToProduction;
  if (wanted('rollbackProductionRelease')) exports.rollbackProductionRelease = require('./releaseManagement').rollbackProductionRelease;

  // 24. Operator alerts in Telegram
  // An hourly check that AI reading works for users and that the blog still
  // publishes, and the Super Admin controls (System Health) that connect it to the
  // owner's Telegram. Built fresh, per the Telegram ruling under Website Leads.
  if (wanted('watchAiAndBlog')) exports.watchAiAndBlog = require('./ops/watcher').watchAiAndBlog;

  // The daily model check: tests each enabled provider's versions and keeps the ones that pass.
  if (wanted('refreshAiModelLists')) exports.refreshAiModelLists = require('./ops/modelRefresh').refreshAiModelLists;

  if (wanted('getPlatformAlerts')) exports.getPlatformAlerts = require('./ops/callables').getPlatformAlerts;
  if (wanted('savePlatformAlertToken')) exports.savePlatformAlertToken = require('./ops/callables').savePlatformAlertToken;
  if (wanted('connectPlatformAlertChat')) exports.connectPlatformAlertChat = require('./ops/callables').connectPlatformAlertChat;
  if (wanted('sendPlatformAlertTest')) exports.sendPlatformAlertTest = require('./ops/callables').sendPlatformAlertTest;
  if (wanted('deletePlatformAlerts')) exports.deletePlatformAlerts = require('./ops/callables').deletePlatformAlerts;

  // 25. Company API: a Company Admin's keys, and the read-only API another service calls with one.
  if (wanted('createCompanyApiKey')) exports.createCompanyApiKey = require('./companyApi/keyCallables').createCompanyApiKey;
  if (wanted('listCompanyApiKeys')) exports.listCompanyApiKeys = require('./companyApi/keyCallables').listCompanyApiKeys;
  if (wanted('revokeCompanyApiKey')) exports.revokeCompanyApiKey = require('./companyApi/keyCallables').revokeCompanyApiKey;
  if (wanted('companyApi')) exports.companyApi = require('./companyApi/http').companyApi;
}

exportFunctions((name) => !functionTarget || name === functionTarget);
if (functionTarget && !Object.prototype.hasOwnProperty.call(exports, functionTarget)) {
  exportFunctions(() => true);
}
