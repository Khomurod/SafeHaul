// hr portal/functions/index.js

const driverSync = require("./driverSync");
const hrAdmin = require("./hrAdmin");
const companyAdmin = require("./companyAdmin");
const leadDistribution = require("./leadDistribution");

// --- 1. DRIVER PROFILE SYNC ---
exports.onApplicationSubmitted = driverSync.onApplicationSubmitted;
exports.onLeadSubmitted = driverSync.onLeadSubmitted;

// --- 2. HR & USER MANAGEMENT ---
exports.createPortalUser = hrAdmin.createPortalUser;
exports.onMembershipWrite = hrAdmin.onMembershipWrite;
exports.deletePortalUser = hrAdmin.deletePortalUser;
exports.updatePortalUser = hrAdmin.updatePortalUser;
exports.joinCompanyTeam = hrAdmin.joinCompanyTeam;

// --- 3. COMPANY ADMINISTRATION ---
exports.deleteCompany = companyAdmin.deleteCompany;
exports.getCompanyProfile = companyAdmin.getCompanyProfile;
exports.moveApplication = companyAdmin.moveApplication;
exports.sendAutomatedEmail = companyAdmin.sendAutomatedEmail;
exports.getTeamPerformanceHistory = companyAdmin.getTeamPerformanceHistory;

// --- 4. MAINTENANCE TOOLS ---
exports.runMigration = companyAdmin.runMigration;
exports.migrateDriversToLeads = companyAdmin.migrateDriversToLeads;

// --- 5. LEAD DISTRIBUTION SYSTEM (CONSOLIDATED) ---

// The Main Scheduled Task (Runs Midnight EST)
// Now points to leadDistribution.js which uses the robust logic
exports.runLeadDistribution = leadDistribution.runLeadDistribution;

// The Manual "Distribute" Button (Callable)
exports.distributeDailyLeads = leadDistribution.distributeDailyLeads;

// Backup/Alias for scheduling
exports.distributeDailyLeadsScheduled = leadDistribution.distributeDailyLeadsScheduled;

// Cleanup Tool
exports.cleanupBadLeads = leadDistribution.cleanupBadLeads;

// Recruiter Logic (Pool Outcomes)
exports.handleLeadOutcome = leadDistribution.handleLeadOutcome;

// Daily Analytics
exports.aggregateAnalytics = leadDistribution.aggregateAnalytics;

// Driver Interest Link
exports.confirmDriverInterest = leadDistribution.confirmDriverInterest;
