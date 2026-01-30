
const fs = require('fs');
const path = require('path');

let rawData = fs.readFileSync('deployed_functions.json', 'utf8');
if (rawData.startsWith('\uFEFF')) {
    rawData = rawData.slice(1);
}
const deployedData = JSON.parse(rawData);
const deployedFunctions = deployedData.result.map(f => f.id);

const localFunctions = [
    'initBulkSession', 'processBulkBatch', 'retryFailedAttempts', 'getFilterCount',
    'getFilteredLeadsPage', 'resumeBulkSession', 'pauseBulkSession', 'cancelBulkSession',
    'sealDocument', 'notifySigner', 'getPublicEnvelope', 'submitPublicEnvelope',
    'createPortalUser', 'deletePortalUser', 'updatePortalUser', 'onMembershipWrite',
    'joinCompanyTeam', 'deleteCompany', 'onApplicationSubmitted', 'onLeadSubmitted',
    'syncDriverOnLog', 'syncDriverOnActivity', 'sendAutomatedEmail', 'cleanupBadLeads',
    'handleLeadOutcome', 'migrateDriversToLeads', 'confirmDriverInterest', 'runLeadDistribution',
    'distributeDailyLeads', 'getLeadSupplyAnalytics', 'recallAllPlatformLeads', 'forceUnlockPool',
    'getBadLeadsAnalytics', 'getCompanyDistributionStatus', 'syncSystemStructure', 'runSecurityAudit',
    'getSignedUploadUrl', 'testEmailConnection', 'runMigration', 'debugAppCounts',
    'connectFacebookPage', 'facebookWebhook', 'facebookWebhookV1', 'saveIntegrationConfig',
    'verifySmsConfig', 'sendTestSMS', 'sendSMS', 'executeReactivationBatch',
    'addPhoneLine', 'removePhoneLine', 'testLineConnection', 'verifyLineConnection',
    'onActivityLogCreated', 'onLegacyActivityCreated', 'onLeadsActivityLogCreated',
    'processCompanyDistribution', 'backfillCompanyStats', 'backfillAllStats',
    'onApplicationUpdateSegments', 'onApplicationCreatedSegments', 'handleOptOut'
];

console.log('--- Missing Deployed Functions ---');
const missing = localFunctions.filter(f => !deployedFunctions.includes(f));
console.log(missing.length > 0 ? missing.join('\n') : 'None');

console.log('\n--- Extra Deployed Functions (Not in index.js) ---');
const extra = deployedFunctions.filter(f => !localFunctions.includes(f));
console.log(extra.length > 0 ? extra.join('\n') : 'None');
