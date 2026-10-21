/**
 * Cloud Functions environment variables (`process.env` in backend code).
 */

const {
    CATEGORIES, SOURCES, AVAILABILITY, SENSITIVITY, DEPLOYMENT_MANAGED,
} = require('./vocabulary');

// ---------------------------------------------------------------------------
// 2. Cloud Functions environment variables (`process.env` in backend code)
// ---------------------------------------------------------------------------

const FUNCTIONS_ENTRIES = [
    // GROQ_VISION_MODEL, GROQ_DOCUMENT_VISION_MODEL and DOCUMENT_VISION_PROVIDER
    // were retired when AI routing moved into the shared platform. Model pins
    // and provider selection are now declared in
    // `functions/ai/registry/providers.js` and overridden per provider from
    // Super Admin → AI Integrations, so there is no deploy-time variable left
    // to register. The AI credentials themselves are listed further down.
    {
        key: 'BULK_SESSION_MAX_SENDS',
        displayName: 'Bulk session send ceiling',
        description: 'Hard ceiling on sends per bulk session. Defaults to 100000 when unset.',
        category: CATEGORIES.FUNCTIONS_ENV,
        integration: 'SafeHaul platform',
        sensitivity: SENSITIVITY.INTERNAL,
        optional: true,
        consumers: ['functions/bulkActions/workers/batchWorker.js'],
        ...DEPLOYMENT_MANAGED,
    },
    {
        key: 'APP_BASE_URL',
        displayName: 'Application base URL',
        description: 'Base URL used to build signing links in outbound email and SMS. Falls back to https://app.safehaul.io.',
        category: CATEGORIES.FUNCTIONS_ENV,
        integration: 'SafeHaul platform',
        sensitivity: SENSITIVITY.PUBLIC,
        optional: true,
        consumers: [
            'functions/notifySigner.js',
            'functions/notifySignerSMS.js',
            'functions/getSigningLink.js',
        ],
        ...DEPLOYMENT_MANAGED,
    },
    {
        key: 'FUNCTION_REGION',
        displayName: 'Cloud Tasks queue region',
        description: 'Region used when enqueuing bulk-campaign worker tasks. Falls back to GCP_REGION, then us-central1.',
        category: CATEGORIES.FUNCTIONS_ENV,
        integration: 'Google Cloud Tasks',
        sensitivity: SENSITIVITY.INTERNAL,
        optional: true,
        consumers: ['functions/bulkActions/services/queueService.js'],
        ...DEPLOYMENT_MANAGED,
    },
    {
        key: 'GCP_REGION',
        displayName: 'Google Cloud region',
        description: 'Secondary region fallback for the Cloud Tasks queue.',
        category: CATEGORIES.FUNCTIONS_ENV,
        integration: 'Google Cloud Tasks',
        sensitivity: SENSITIVITY.INTERNAL,
        optional: true,
        consumers: ['functions/bulkActions/services/queueService.js'],
        ...DEPLOYMENT_MANAGED,
    },
].map((entry) => ({
    ...entry,
    scope: 'global',
    source: SOURCES.FUNCTIONS_ENV,
    availability: AVAILABILITY.SERVER_RUNTIME,
    requiresDeployment: true,
}));

module.exports = { FUNCTIONS_ENTRIES };
