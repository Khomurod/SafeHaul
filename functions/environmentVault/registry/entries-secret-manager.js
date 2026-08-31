/**
 * Secret Manager-backed values.
 */

const { CATEGORIES, SOURCES, AVAILABILITY, SENSITIVITY, PROTECTED } = require('./vocabulary');

// ---------------------------------------------------------------------------
// 3. Secret Manager-backed values
// ---------------------------------------------------------------------------

const SECRET_MANAGER_ENTRIES = [
    // --- Release Management -------------------------------------------------
    //
    // The GitHub App installation the Super Admin Release Management screen uses
    // to start a production promotion. Between them these three are the most
    // powerful non-Google credential SafeHaul holds: they decide what
    // app.safehaul.io serves. They are inventoried here, like every other
    // platform secret, so "what can change production, and where does it live"
    // has one answer rather than being folklore.
    {
        key: 'RELEASE_GITHUB_APP_ID',
        displayName: 'Release GitHub App ID',
        description: 'Numeric identifier of the GitHub App that dispatches the production promotion workflow. Not secret on its own; useless without the private key.',
        category: CATEGORIES.DEPLOYMENT_OPS,
        integration: 'GitHub (release)',
        sensitivity: SENSITIVITY.INTERNAL,
        consumers: ['functions/releaseManagement/github.js'],
    },
    {
        key: 'RELEASE_GITHUB_INSTALLATION_ID',
        displayName: 'Release GitHub App installation ID',
        description: 'Identifies the single installation of the release App on Khomurod/SafeHaul. Scoping the token exchange to one installation is what keeps the credential unable to reach any other repository.',
        category: CATEGORIES.DEPLOYMENT_OPS,
        integration: 'GitHub (release)',
        sensitivity: SENSITIVITY.INTERNAL,
        consumers: ['functions/releaseManagement/github.js'],
    },
    {
        key: 'RELEASE_GITHUB_PRIVATE_KEY',
        displayName: 'Release GitHub App private key',
        description: 'RSA private key that signs the App JWT used to mint one-hour installation tokens. Grants Actions write, plus Contents/Deployments/Checks read, on Khomurod/SafeHaul only — it cannot push code, merge, change workflows or read repository secrets. Anything holding it can start a production release.',
        category: CATEGORIES.DEPLOYMENT_OPS,
        integration: 'GitHub (release)',
        sensitivity: SENSITIVITY.CRITICAL,
        consumers: ['functions/releaseManagement/github.js'],
    },
    {
        key: 'GROQ_API_KEY',
        displayName: 'Groq API key (legacy deploy binding)',
        description: 'The original deploy-time Groq binding. Superseded by SAFEHAUL_AI_GROQ_APIKEY, which is managed from Super Admin → AI Integrations. This row is retained as the rollback path during the AI credential migration and is read only when the managed credential is absent.',
        category: CATEGORIES.GLOBAL_INTEGRATION,
        integration: 'Groq (AI)',
        sensitivity: SENSITIVITY.CRITICAL,
        consumers: ['functions/cdlParser.js', 'functions/ai/credentials/store.js'],
    },
    {
        key: 'BULK_WORKER_SECRET',
        displayName: 'Bulk worker shared secret',
        description: 'Shared secret authenticating Cloud Tasks calls into processBulkBatch. The worker rejects every request when it is unset.',
        category: CATEGORIES.INFRASTRUCTURE,
        integration: 'SafeHaul platform',
        sensitivity: SENSITIVITY.CRITICAL,
        consumers: [
            'functions/bulkActions/services/queueService.js',
            'functions/bulkActions/workers/batchWorker.js',
        ],
    },
    {
        key: 'PROCESS_BULK_BATCH_URL',
        displayName: 'Bulk batch worker URL',
        description: 'Cloud Run URL of processBulkBatch. Cloud Tasks needs it to recurse through a campaign.',
        category: CATEGORIES.FUNCTIONS_ENV,
        integration: 'SafeHaul platform',
        sensitivity: SENSITIVITY.INTERNAL,
        consumers: ['functions/bulkActions/services/queueService.js'],
    },
    {
        key: 'SMS_ENCRYPTION_KEY',
        displayName: 'SMS credential encryption key',
        description: 'AES-256 key that encrypts every stored SMS provider credential, dedicated-line JWT and legacy SMTP password. Rotating it makes every existing ciphertext undecryptable.',
        category: CATEGORIES.INFRASTRUCTURE,
        integration: 'SafeHaul platform',
        sensitivity: SENSITIVITY.CRITICAL,
        consumers: [
            'functions/integrations/encryption.js',
            'functions/integrations/controllers/config/*.js',
            'functions/integrations/services/smsService.js',
            'functions/bulkActions/workers/batchWorker.js',
            'functions/atsContactSms.js',
            'functions/notifySignerSMS.js',
            'functions/driverSync.js',
            'functions/migrateEmailSettings.js',
        ],
    },
    {
        key: 'FACEBOOK_APP_ID',
        displayName: 'Facebook app ID (server)',
        description: 'Server-side Facebook app identifier used in the long-lived page-token exchange.',
        category: CATEGORIES.GLOBAL_INTEGRATION,
        integration: 'Facebook Lead Ads',
        sensitivity: SENSITIVITY.SENSITIVE,
        consumers: ['functions/integrations/facebook.js'],
    },
    {
        key: 'FACEBOOK_APP_SECRET',
        displayName: 'Facebook app secret',
        description: 'Server-side Facebook app secret used for the token exchange and webhook payload signature verification.',
        category: CATEGORIES.GLOBAL_INTEGRATION,
        integration: 'Facebook Lead Ads',
        sensitivity: SENSITIVITY.CRITICAL,
        consumers: ['functions/integrations/facebook.js'],
    },
    {
        key: 'FACEBOOK_VERIFY_TOKEN',
        displayName: 'Facebook webhook verify token',
        description: 'Token Facebook echoes during the webhook subscription handshake.',
        category: CATEGORIES.GLOBAL_INTEGRATION,
        integration: 'Facebook Lead Ads',
        sensitivity: SENSITIVITY.SENSITIVE,
        consumers: ['functions/integrations/facebook.js'],
    },
].map((entry) => ({
    ...entry,
    scope: 'global',
    source: SOURCES.SECRET_MANAGER,
    availability: AVAILABILITY.SERVER_RUNTIME,
    requiresDeployment: true,
    ...PROTECTED,
}));

module.exports = { SECRET_MANAGER_ENTRIES };
