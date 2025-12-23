// hr portal/functions/index.js

const driverSync = require("./driverSync");
const hrAdmin = require("./hrAdmin");
const companyAdmin = require("./companyAdmin");
const leadDistribution = require("./leadDistribution");

// --- 1. DRIVER PROFILE SYNC (Triggers) ---
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

// --- 4. SCHEDULED TASKS & MAINTENANCE ---
// The main scheduled task (runs every 24 hours)
exports.runLeadDistribution = companyAdmin.runLeadDistribution;
// The manual migration tool
exports.runMigration = companyAdmin.runMigration;
// Alias for migration (for compatibility)
exports.migrateDriversToLeads = companyAdmin.migrateDriversToLeads;

// --- 5. LEAD DISTRIBUTION & ANALYTICS ---
// The "Distribute Leads" button (Manual Callable)
exports.distributeDailyLeads = leadDistribution.distributeDailyLeads;

// The Scheduled Backup (Midnight EST)
exports.distributeDailyLeadsScheduled = leadDistribution.distributeDailyLeadsScheduled;

// Cleanup Tool (Manual Callable)
exports.cleanupBadLeads = leadDistribution.cleanupBadLeads;

// Recruiter Logic (Pool Outcomes)
exports.handleLeadOutcome = leadDistribution.handleLeadOutcome;

// Daily Analytics (Scheduled 11:55 PM)
exports.aggregateAnalytics = leadDistribution.aggregateAnalytics;

// Driver Interest Link Handler (Public Callable)
exports.confirmDriverInterest = leadDistribution.confirmDriverInterest;