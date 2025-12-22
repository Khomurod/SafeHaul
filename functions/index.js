// hr portal/functions/index.js

// 1. Driver Profile Synchronization (Triggers)
const driverSync = require("./driverSync");
exports.onApplicationSubmitted = driverSync.onApplicationSubmitted;
exports.onLeadSubmitted = driverSync.onLeadSubmitted;

// 2. HR User and Membership Management
const hrAdmin = require("./hrAdmin");
exports.createPortalUser = hrAdmin.createPortalUser;
exports.onMembershipWrite = hrAdmin.onMembershipWrite;
exports.deletePortalUser = hrAdmin.deletePortalUser;
exports.updatePortalUser = hrAdmin.updatePortalUser;
exports.joinCompanyTeam = hrAdmin.joinCompanyTeam;

// 3. Company Administration (CRUD, Emails, Distribution)
const companyAdmin = require("./companyAdmin");

// --- Existing Company Admin Features ---
// (Ensure these functions exist in your companyAdmin.js if you need them)
exports.deleteCompany = companyAdmin.deleteCompany;
exports.getCompanyProfile = companyAdmin.getCompanyProfile;
exports.moveApplication = companyAdmin.moveApplication;
exports.sendAutomatedEmail = companyAdmin.sendAutomatedEmail;
exports.getTeamPerformanceHistory = companyAdmin.getTeamPerformanceHistory;

// --- NEW: Lead Distribution & Migration (Moved here from leadDistribution) ---
exports.runLeadDistribution = companyAdmin.runLeadDistribution;   // The new Scheduled Task
exports.runMigration = companyAdmin.runMigration;                 // The new Manual Tool
exports.migrateDriversToLeads = companyAdmin.migrateDriversToLeads; // Alias for compatibility

// 4. Lead Distribution & Analytics (Remaining items)
const leadDistribution = require("./leadDistribution");

// Note: The daily distribution and migration logic has been moved to companyAdmin above.
// exports.distributeDailyLeads = leadDistribution.distributeDailyLeads; 
// exports.distributeDailyLeadsScheduled = leadDistribution.distributeDailyLeadsScheduled;
// exports.migrateDriversToLeads = leadDistribution.migrateDriversToLeads;

exports.cleanupBadLeads = leadDistribution.cleanupBadLeads;
exports.handleLeadOutcome = leadDistribution.handleLeadOutcome;
exports.aggregateAnalytics = leadDistribution.aggregateAnalytics;
exports.confirmDriverInterest = leadDistribution.confirmDriverInterest;