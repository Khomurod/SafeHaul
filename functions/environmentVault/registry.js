/**
 * SafeHaul environment & integration registry — the single machine-readable
 * inventory of every configuration key, secret and integration credential the
 * product actually uses.
 *
 * This file is the source of truth. It is deliberately *declarative*: it names
 * where a value lives, who reads it, whether it can be read back, and which
 * operations the source genuinely supports. Nothing here holds a secret value —
 * retrieval happens in `values.js`, one requested entry at a time.
 *
 * Two guards keep it honest:
 *  - `test/unit/environmentRegistry.inventory.test.js` scans the whole
 *    repository for `process.env.X`, `import.meta.env.X`, `defineSecret("X")`,
 *    `secrets: ['X']` and `${{ secrets.X }}` and fails if any key is not
 *    registered here. A new configuration key cannot silently escape the vault.
 *  - the same suite fails if this file registers a key that nothing in the
 *    repository references, so the inventory cannot drift into fiction either
 *    (documented exceptions are listed in `UNREFERENCED_BY_DESIGN`).
 *
 * ## Why `source` and `category` are both present and both needed
 *
 * `source` is *where the value is stored* and therefore decides what can be done
 * to it. `category` is *what kind of configuration it is* and is what an
 * operator filters by. They overlap but are not the same axis: a public value
 * can be inlined into the browser while its deployment source remains Google.
 */

/** Configuration categories, matching the operator-facing filter. */
const CATEGORIES = Object.freeze({
    BROWSER_BUILD: 'browser-build',
    FUNCTIONS_ENV: 'functions-env',
    SECRET_MANAGER: 'secret-manager',
    GITHUB_ACTIONS: 'github-actions',
    FIREBASE_CONFIG: 'firebase-config',
    GLOBAL_INTEGRATION: 'global-integration',
    COMPANY_INTEGRATION: 'company-integration',
    INFRASTRUCTURE: 'infrastructure-security',
    PUBLIC_CONFIG: 'public-config',
    DEPLOYMENT_OPS: 'deployment-operations',
});

/** Storage locations. A row's source decides which operations are possible. */
const SOURCES = Object.freeze({
    /** Inlined into the browser bundle by Vite at build time. */
    VITE_BUILD: 'vite-build',
    /** Legacy plain Functions environment value. */
    FUNCTIONS_ENV: 'functions-env',
    /** Google Secret Manager, bound with `secrets: [...]` / `defineSecret`. */
    SECRET_MANAGER: 'secret-manager',
    /** GitHub Actions repository secret. */
    GITHUB_SECRET: 'github-actions-secret',
    /** Literal `env:` value committed in a workflow file. */
    WORKFLOW_ENV: 'github-actions-variable',
    /** Injected into the Cloud Functions runtime by the platform. */
    FIREBASE_RUNTIME: 'firebase-runtime',
    /** Committed repository configuration (`.firebaserc`, `firebase.json`). */
    REPO_CONFIG: 'repo-config',
    /** Encrypted-at-rest field on a Firestore document. */
    FIRESTORE_ENCRYPTED: 'firestore-encrypted',
    /** Plaintext-at-rest field on an access-restricted Firestore document. */
    FIRESTORE_PLAINTEXT: 'firestore-plaintext',
    /** Supplied by the local shell / CI runner for SafeHaul tooling. */
    LOCAL_TOOLING: 'local-tooling',
});

/**
 * How — and whether — the current value can be read back.
 *
 * `NOT_RETRIEVABLE` is the honest answer for GitHub Actions secrets: GitHub
 * never returns a stored secret's plaintext through its API. Those rows stay
 * listed and keep their eye control; the reveal reports the limitation instead
 * of inventing a value.
 */
const AVAILABILITY = Object.freeze({
    /** Already present in the shipped bundle; resolved in the browser. */
    BROWSER_VISIBLE: 'browser-visible',
    /** Read from `process.env` inside the reveal callable. */
    SERVER_RUNTIME: 'server-runtime',
    /** Decrypted server-side from Firestore. */
    FIRESTORE_ENCRYPTED: 'firestore-encrypted',
    /** Read server-side from Firestore without decryption. */
    FIRESTORE_PLAINTEXT: 'firestore-plaintext',
    /** Non-secret value committed in the repository. */
    KNOWN_LITERAL: 'known-literal',
    /** The source does not permit reading the saved value. */
    NOT_RETRIEVABLE: 'not-retrievable',
});

const SENSITIVITY = Object.freeze({
    PUBLIC: 'public',
    INTERNAL: 'internal',
    SENSITIVE: 'sensitive',
    CRITICAL: 'critical',
});

/** Reasons shown on a disabled control. Kept short enough for a tooltip. */
const REASONS = Object.freeze({
    DEPLOYMENT_MANAGED: 'Managed by deployment',
    PROTECTED_INFRASTRUCTURE: 'Protected infrastructure key',
    SOURCE_NO_EDIT: 'Source does not support editing',
    SOURCE_NO_DELETE: 'Source does not support deletion',
    SOURCE_NO_ADD: 'Source does not support adding keys here',
    READ_ONLY_GENERATED: 'Read-only generated value',
    REFERENCED: 'Cannot be deleted while referenced',
    PLATFORM_INJECTED: 'Injected by the platform at runtime',
});

/** No operation is available. The default for everything the vault only reads. */
const READ_ONLY = Object.freeze({
    revealable: true,
    editable: false,
    replaceable: false,
    addable: false,
    deletable: false,
    testable: false,
});

function readOnly(reason) {
    return {
        permissions: { ...READ_ONLY },
        restrictions: {
            edit: reason,
            replace: reason,
            add: REASONS.SOURCE_NO_ADD,
            delete: REASONS.SOURCE_NO_DELETE,
        },
    };
}

/**
 * Deployment-managed rows: the value is real and readable, but writing it here
 * would be a lie — the release workflow rewrites it on the next deploy.
 */
const DEPLOYMENT_MANAGED = readOnly(REASONS.DEPLOYMENT_MANAGED);
const PROTECTED = readOnly(REASONS.PROTECTED_INFRASTRUCTURE);
const PLATFORM = readOnly(REASONS.PLATFORM_INJECTED);

// ---------------------------------------------------------------------------
// 1. Browser / build variables (`import.meta.env.VITE_*`)
// ---------------------------------------------------------------------------

const FIREBASE_WEB_KEYS = [
    ['VITE_FIREBASE_API_KEY', 'Firebase Web API key', 'Browser SDK API key. Public by design — Firebase security rules, not this key, enforce access.'],
    ['VITE_FIREBASE_AUTH_DOMAIN', 'Firebase auth domain', 'Hosted sign-in domain used by the Firebase Auth browser SDK.'],
    ['VITE_FIREBASE_PROJECT_ID', 'Firebase project ID', 'Firebase project the browser SDK talks to.'],
    ['VITE_FIREBASE_STORAGE_BUCKET', 'Firebase Storage bucket', 'Default Cloud Storage bucket for browser uploads and downloads.'],
    ['VITE_FIREBASE_MESSAGING_SENDER_ID', 'Firebase messaging sender ID', 'Firebase Cloud Messaging sender identifier.'],
    ['VITE_FIREBASE_APP_ID', 'Firebase web app ID', 'Identifies this web app inside the Firebase project.'],
];

const BROWSER_ENTRIES = [
    ...FIREBASE_WEB_KEYS.map(([key, displayName, description]) => ({
        key,
        displayName,
        description,
        category: CATEGORIES.PUBLIC_CONFIG,
        integration: 'Firebase',
        sensitivity: SENSITIVITY.PUBLIC,
        consumers: ['src/lib/firebase/config.js'],
    })),
    {
        key: 'VITE_FACEBOOK_APP_ID',
        displayName: 'Facebook app ID (browser)',
        description: 'Public Facebook app identifier used to start the Lead Ads OAuth flow from the company Integrations tab.',
        category: CATEGORIES.PUBLIC_CONFIG,
        integration: 'Facebook Lead Ads',
        sensitivity: SENSITIVITY.PUBLIC,
        consumers: ['src/features/settings/components/IntegrationsTab.jsx'],
    },
    {
        key: 'VITE_SENTRY_DSN',
        displayName: 'Sentry DSN',
        description: 'Public Sentry ingest endpoint for browser error monitoring.',
        category: CATEGORIES.PUBLIC_CONFIG,
        integration: 'Sentry',
        sensitivity: SENSITIVITY.PUBLIC,
        consumers: ['src/main.jsx'],
    },
    {
        key: 'VITE_SENTRY_TRACES_SAMPLE_RATE',
        displayName: 'Sentry trace sample rate',
        description: 'Fraction of browser transactions sampled for performance tracing. Defaults to 0.2 when unset.',
        category: CATEGORIES.PUBLIC_CONFIG,
        integration: 'Sentry',
        sensitivity: SENSITIVITY.PUBLIC,
        consumers: ['src/main.jsx'],
    },
    {
        key: 'VITE_SOCRATA_APP_TOKEN',
        displayName: 'Socrata app token',
        description: 'Public Transportation.gov / Socrata application token used for FMCSA carrier autocomplete rate limits.',
        category: CATEGORIES.GLOBAL_INTEGRATION,
        integration: 'Socrata (FMCSA)',
        sensitivity: SENSITIVITY.INTERNAL,
        consumers: [
            'src/features/driver-app/components/application/steps/components/EmployerNameAutocomplete.jsx',
            'src/features/company-admin/components/modals/PEVRequestModal.jsx',
        ],
    },
    {
        key: 'VITE_DRIVER_APP_URL',
        displayName: 'Driver app base URL',
        description: 'Base URL used when building driver-facing links shown to staff.',
        category: CATEGORIES.PUBLIC_CONFIG,
        integration: 'SafeHaul platform',
        sensitivity: SENSITIVITY.PUBLIC,
        consumers: [
            'src/shared/components/modals/ManageTeamModal.jsx',
            'src/features/settings/components/PersonalProfileTab.jsx',
        ],
    },
    {
        key: 'VITE_USE_DASHBOARD_SUMMARY',
        displayName: 'Dashboard rollup toggle',
        description: 'Set to "false" to bypass the pre-aggregated dashboard rollup and always run on-demand aggregate queries.',
        category: CATEGORIES.PUBLIC_CONFIG,
        integration: 'SafeHaul platform',
        sensitivity: SENSITIVITY.PUBLIC,
        consumers: ['src/lib/runtime/dashboardRollup.js'],
    },
    {
        key: 'VITE_RELEASE_SHA',
        displayName: 'Release commit SHA',
        description: 'Commit the deployed bundle was built from. Set by the deploy workflow and reported to Sentry as the release.',
        category: CATEGORIES.PUBLIC_CONFIG,
        integration: 'Sentry',
        sensitivity: SENSITIVITY.PUBLIC,
        consumers: ['src/main.jsx'],
    },
    {
        key: 'VITE_E2E_TEST_MODE',
        displayName: 'E2E test mode',
        description: 'Set to "1" by the Playwright dev server only. Forces the placeholder Firebase project and an unreachable Firestore so browser tests can never touch real data.',
        category: CATEGORIES.DEPLOYMENT_OPS,
        integration: 'SafeHaul platform',
        sensitivity: SENSITIVITY.PUBLIC,
        consumers: ['src/lib/firebase/config.js', 'src/App.jsx', 'playwright.config.cjs'],
    },
    {
        key: 'VITE_USE_REAL_FIREBASE_IN_TESTS',
        displayName: 'Real Firebase in unit tests',
        description: 'Opt-in escape hatch for the Vitest setup file. Unset in normal operation; Firebase is stubbed.',
        category: CATEGORIES.DEPLOYMENT_OPS,
        integration: 'SafeHaul platform',
        sensitivity: SENSITIVITY.PUBLIC,
        consumers: ['src/tests/setup.js'],
    },
    {
        key: 'VITE_SUPER_ADMIN_EMAIL',
        displayName: 'Super Admin fallback email',
        description: 'Historical fallback for Super Admin identification. Injected by the deploy workflow and documented in .env.example, but no application code reads it — Firebase custom claims (globalRole) are the only authority.',
        category: CATEGORIES.PUBLIC_CONFIG,
        integration: 'SafeHaul platform',
        sensitivity: SENSITIVITY.INTERNAL,
        consumers: [],
        noKnownConsumer: true,
    },
].map((entry) => ({
    ...entry,
    scope: 'global',
    source: SOURCES.VITE_BUILD,
    availability: AVAILABILITY.BROWSER_VISIBLE,
    requiresDeployment: true,
    ...readOnly(REASONS.DEPLOYMENT_MANAGED),
}));

// ---------------------------------------------------------------------------
// 2. Cloud Functions environment variables (`process.env` in backend code)
// ---------------------------------------------------------------------------

const FUNCTIONS_ENTRIES = [
    {
        key: 'GROQ_VISION_MODEL',
        displayName: 'Groq CDL vision model',
        description: 'Model pin for the CDL parser. Falls back to meta-llama/llama-4-scout-17b-16e-instruct.',
        category: CATEGORIES.FUNCTIONS_ENV,
        integration: 'Groq (AI)',
        sensitivity: SENSITIVITY.INTERNAL,
        consumers: ['functions/cdlParser.js'],
        ...DEPLOYMENT_MANAGED,
    },
    {
        key: 'GROQ_DOCUMENT_VISION_MODEL',
        displayName: 'Groq document vision model',
        description: 'Model pin for document analysis. Deliberately separate from the CDL pin so one can move without the other.',
        category: CATEGORIES.FUNCTIONS_ENV,
        integration: 'Groq (AI)',
        sensitivity: SENSITIVITY.INTERNAL,
        consumers: ['functions/shared/documentVisionProvider.js'],
        ...DEPLOYMENT_MANAGED,
    },
    {
        key: 'DOCUMENT_VISION_PROVIDER',
        displayName: 'Document vision provider',
        description: 'Selects the document-vision backend. Defaults to "groq" when unset.',
        category: CATEGORIES.FUNCTIONS_ENV,
        integration: 'Groq (AI)',
        sensitivity: SENSITIVITY.INTERNAL,
        optional: true,
        consumers: ['functions/shared/documentVisionProvider.js'],
        ...DEPLOYMENT_MANAGED,
    },
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
    {
        key: 'FACEBOOK_APP_SECRET_VALUE',
        displayName: 'Facebook app secret (legacy V1 webhook)',
        description: 'Plain environment copy of the Facebook app secret read by the legacy V1 webhook signature check. The V2 webhook uses the Secret Manager binding instead.',
        category: CATEGORIES.GLOBAL_INTEGRATION,
        integration: 'Facebook Lead Ads',
        sensitivity: SENSITIVITY.CRITICAL,
        optional: true,
        consumers: ['functions/integrations/facebook.js'],
        ...PROTECTED,
    },
    {
        key: 'FACEBOOK_VERIFY_TOKEN_VALUE',
        displayName: 'Facebook verify token (legacy V1 webhook)',
        description: 'Plain environment copy of the Facebook webhook verify token read by the legacy V1 webhook handshake.',
        category: CATEGORIES.GLOBAL_INTEGRATION,
        integration: 'Facebook Lead Ads',
        sensitivity: SENSITIVITY.SENSITIVE,
        optional: true,
        consumers: ['functions/integrations/facebook.js'],
        ...PROTECTED,
    },
].map((entry) => ({
    ...entry,
    scope: 'global',
    source: SOURCES.FUNCTIONS_ENV,
    availability: AVAILABILITY.SERVER_RUNTIME,
    requiresDeployment: true,
}));

// ---------------------------------------------------------------------------
// 3. Secret Manager-backed values
// ---------------------------------------------------------------------------

const SECRET_MANAGER_ENTRIES = [
    {
        key: 'GROQ_API_KEY',
        displayName: 'Groq API key',
        description: 'Authenticates SafeHaul to Groq for CDL OCR and E-Doc field-placement analysis.',
        category: CATEGORIES.GLOBAL_INTEGRATION,
        integration: 'Groq (AI)',
        sensitivity: SENSITIVITY.CRITICAL,
        consumers: ['functions/cdlParser.js', 'functions/shared/documentVisionProvider.js'],
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
    {
        key: 'LANDING_TELEGRAM_BOT_TOKEN',
        displayName: 'Landing-page Telegram bot token',
        description: 'Authenticates the server-side safehaul.io sales lead notifier to Telegram. It must never be shipped to browser code.',
        category: CATEGORIES.GLOBAL_INTEGRATION,
        integration: 'Telegram (landing leads)',
        sensitivity: SENSITIVITY.CRITICAL,
        consumers: ['functions/landingLead.js'],
    },
    {
        key: 'LANDING_TELEGRAM_CHAT_ID',
        displayName: 'Landing-page Telegram chat ID',
        description: 'Destination chat for validated sales leads submitted through safehaul.io.',
        category: CATEGORIES.GLOBAL_INTEGRATION,
        integration: 'Telegram (landing leads)',
        sensitivity: SENSITIVITY.SENSITIVE,
        consumers: ['functions/landingLead.js'],
    },
].map((entry) => ({
    ...entry,
    scope: 'global',
    source: SOURCES.SECRET_MANAGER,
    availability: AVAILABILITY.SERVER_RUNTIME,
    requiresDeployment: true,
    ...PROTECTED,
}));

// ---------------------------------------------------------------------------
// 4. GitHub's automatic per-run token
//
// SafeHaul stores no application or deployment secrets in GitHub. GITHUB_TOKEN
// is minted automatically for one workflow run and cannot be moved elsewhere.
// ---------------------------------------------------------------------------

const GITHUB_SECRET_KEYS = [
    ['GITHUB_TOKEN', 'GitHub Actions', SENSITIVITY.SENSITIVE, 'Ephemeral token GitHub mints per workflow run; used by the Gitleaks secret scan.'],
];

const GITHUB_ENTRIES = GITHUB_SECRET_KEYS.map(([key, integration, sensitivity, description]) => ({
    key,
    displayName: `${key} (GitHub Actions secret)`,
    description,
    category: CATEGORIES.GITHUB_ACTIONS,
    integration,
    sensitivity,
    scope: 'global',
    source: SOURCES.GITHUB_SECRET,
    availability: AVAILABILITY.NOT_RETRIEVABLE,
    requiresDeployment: true,
    consumers: ['.github/workflows/main.yml'],
    ...readOnly(REASONS.SOURCE_NO_EDIT),
}));

// ---------------------------------------------------------------------------
// 5. Firebase deployment and runtime configuration
// ---------------------------------------------------------------------------

const FIREBASE_ENTRIES = [
    {
        key: 'FIREBASE_CONFIG',
        displayName: 'Firebase runtime config blob',
        description: 'JSON blob the Cloud Functions runtime injects, carrying the project ID and default bucket.',
        source: SOURCES.FIREBASE_RUNTIME,
        availability: AVAILABILITY.SERVER_RUNTIME,
        sensitivity: SENSITIVITY.INTERNAL,
        consumers: ['functions/bulkActions/services/queueService.js'],
    },
    {
        key: 'GCLOUD_PROJECT',
        displayName: 'Google Cloud project ID (runtime)',
        description: 'Project ID injected into the Cloud Functions runtime.',
        source: SOURCES.FIREBASE_RUNTIME,
        availability: AVAILABILITY.SERVER_RUNTIME,
        sensitivity: SENSITIVITY.PUBLIC,
        consumers: ['functions/bulkActions/services/queueService.js'],
    },
    {
        key: 'GCP_PROJECT',
        displayName: 'Google Cloud project ID (legacy runtime)',
        description: 'Legacy project-ID variable kept as a fallback for older runtimes.',
        source: SOURCES.FIREBASE_RUNTIME,
        availability: AVAILABILITY.SERVER_RUNTIME,
        sensitivity: SENSITIVITY.PUBLIC,
        optional: true,
        consumers: ['functions/bulkActions/services/queueService.js'],
    },
    {
        key: 'FUNCTIONS_EMULATOR',
        displayName: 'Functions emulator flag',
        description: 'Set by the Firebase emulator suite. Present only when running locally.',
        source: SOURCES.FIREBASE_RUNTIME,
        availability: AVAILABILITY.SERVER_RUNTIME,
        sensitivity: SENSITIVITY.PUBLIC,
        optional: true,
        consumers: ['functions/bulkActions/services/queueService.js'],
    },
    {
        key: 'FIREBASE_PROJECT_ID',
        displayName: 'Deployment target project',
        description: 'Firebase project the deploy jobs and deployment scripts target.',
        source: SOURCES.WORKFLOW_ENV,
        availability: AVAILABILITY.KNOWN_LITERAL,
        literalValue: 'truckerapp-system',
        sensitivity: SENSITIVITY.PUBLIC,
        consumers: [
            '.github/workflows/main.yml',
            'scripts/deploy-functions-incremental.mjs',
            'scripts/deploy-functions-sequential.mjs',
            'scripts/smoke-functions-deploy.mjs',
        ],
    },
].map((entry) => ({
    ...entry,
    displayName: entry.displayName,
    category: CATEGORIES.FIREBASE_CONFIG,
    integration: 'Firebase',
    scope: 'global',
    requiresDeployment: false,
    ...PLATFORM,
}));

// ---------------------------------------------------------------------------
// 6. Deployment and operations tooling
// ---------------------------------------------------------------------------

const OPS_ENTRIES = [
    ['DEPLOY_FUNCTIONS_DRY_RUN', 'Deploy dry-run flag', 'Set to "1" to print the incremental deploy plan without invoking Firebase.', ['scripts/deploy-functions-incremental.mjs']],
    ['DEPLOY_FUNCTIONS_FORCE_FULL', 'Force full function deploy', 'Set to "1" to deploy every Cloud Function instead of only changed ones.', ['scripts/deploy-functions-incremental.mjs']],
    ['DEPLOY_FUNCTIONS_ALWAYS_INCLUDE', 'Always-deploy function list', 'Comma-separated functions the incremental planner always includes.', ['scripts/deploy-functions-incremental.mjs', '.github/workflows/main.yml']],
    ['DEPLOY_FUNCTIONS_SLEEP_SEC', 'Sequential deploy pause', 'Seconds to pause between sequential function deploys.', ['scripts/deploy-functions-sequential.mjs', '.github/workflows/main.yml']],
    ['DEPLOY_GIT_BASE', 'Deploy diff base ref', 'Overrides the base commit the incremental planner diffs against.', ['scripts/deploy-functions-incremental.mjs']],
    ['DEPLOY_GIT_HEAD', 'Deploy diff head ref', 'Overrides the head commit the incremental planner diffs against.', ['scripts/deploy-functions-incremental.mjs']],
    ['GITHUB_PUSH_BEFORE', 'Push before-SHA', 'Previous head of the pushed branch, supplied by GitHub Actions.', ['scripts/deploy-functions-incremental.mjs', '.github/workflows/main.yml']],
    ['GITHUB_SHA', 'Workflow commit SHA', 'Commit the workflow run is building, supplied by GitHub Actions.', ['scripts/deploy-functions-incremental.mjs', '.github/workflows/main.yml']],
    ['RULES_STRESS_LOOPS', 'Rules stress loop count', 'Number of times the Firestore/Storage rules suite repeats in the emulator flake guard.', ['scripts/run-rules-stress.mjs', '.github/workflows/main.yml']],
    ['FIRESTORE_EMULATOR_HOST', 'Firestore emulator host', 'Host:port the rules suite points the Firestore SDK at.', ['scripts/run-rules-stress.mjs', 'src/tests/firestore.rules.security.test.js']],
    ['FIREBASE_STORAGE_EMULATOR_HOST', 'Storage emulator host', 'Host:port the rules suite points the Storage SDK at.', ['scripts/run-rules-stress.mjs', 'src/tests/storage.rules.security.test.js']],
    ['PW_CHROMIUM_EXECUTABLE', 'Playwright Chromium path', 'Absolute path to a system Chromium for the Playwright chromium lanes.', ['playwright.config.cjs']],
    ['CI', 'CI flag', 'Set by GitHub Actions. Switches Playwright to one worker with retries and forbids test.only.', ['playwright.config.cjs']],
    ['npm_execpath', 'npm executable path', 'Path npm exposes to the running script; the rules stress runner uses it to re-invoke npm.', ['scripts/run-rules-stress.mjs']],
].map(([key, displayName, description, consumers]) => ({
    key,
    displayName,
    description,
    consumers,
    category: CATEGORIES.DEPLOYMENT_OPS,
    integration: 'SafeHaul platform',
    scope: 'global',
    source: SOURCES.LOCAL_TOOLING,
    availability: AVAILABILITY.NOT_RETRIEVABLE,
    sensitivity: SENSITIVITY.PUBLIC,
    optional: true,
    requiresDeployment: false,
    ...readOnly(REASONS.SOURCE_NO_EDIT),
}));

// ---------------------------------------------------------------------------
// 7. Repository configuration
// ---------------------------------------------------------------------------

const REPO_ENTRIES = [
    {
        key: 'firebase.default_project',
        displayName: 'Default Firebase project (.firebaserc)',
        description: 'Default project the Firebase CLI resolves for local commands.',
        category: CATEGORIES.FIREBASE_CONFIG,
        integration: 'Firebase',
        scope: 'global',
        source: SOURCES.REPO_CONFIG,
        availability: AVAILABILITY.KNOWN_LITERAL,
        literalValue: 'truckerapp-system',
        sensitivity: SENSITIVITY.PUBLIC,
        requiresDeployment: false,
        consumers: ['.firebaserc'],
        ...PLATFORM,
    },
    {
        key: 'signing.envelope_token_store',
        displayName: 'Envelope signing token store',
        description: 'Per-envelope signing tokens live at companies/{companyId}/signing_requests/{id}/secrets/token. They are minted and destroyed per signing request, so they are runtime data rather than a configuration value and are not enumerated here.',
        category: CATEGORIES.INFRASTRUCTURE,
        integration: 'SafeHaul e-signature',
        scope: 'global',
        source: SOURCES.FIRESTORE_PLAINTEXT,
        availability: AVAILABILITY.NOT_RETRIEVABLE,
        sensitivity: SENSITIVITY.CRITICAL,
        requiresDeployment: false,
        consumers: [
            'functions/publicSigning.js',
            'functions/getSigningLink.js',
            'functions/notifySigner.js',
            'functions/notifySignerSMS.js',
            'functions/postApplicationEdocs.js',
        ],
        ...PROTECTED,
        unavailableReason: 'Per-envelope runtime tokens are not a single configuration value.',
    },
];

// ---------------------------------------------------------------------------
// Company-scoped integration credential templates
//
// Each field gets its own row and its own permission policy. An integration
// document is never treated as one secret.
// ---------------------------------------------------------------------------

/** `companies/{companyId}/integrations/sms_provider` */
const SMS_PROVIDER_FIELDS = [
    {
        field: 'provider',
        displayName: 'SMS provider',
        description: 'Which SMS provider this company sends through (ringcentral or 8x8).',
        encrypted: false,
        sensitivity: SENSITIVITY.PUBLIC,
        editable: false,
        deletable: false,
        // The provider row carries the integration-level connectivity test, so
        // "Test integration" has exactly one home per company instead of one per
        // credential field.
        testable: true,
        editReason: REASONS.REFERENCED,
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'clientId',
        inConfig: true,
        displayName: 'RingCentral client ID',
        description: 'RingCentral app client ID used for JWT login.',
        encrypted: true,
        sensitivity: SENSITIVITY.SENSITIVE,
        providers: ['ringcentral'],
        editable: true,
        deletable: false,
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'clientSecret',
        inConfig: true,
        displayName: 'RingCentral client secret',
        description: 'RingCentral app client secret used for JWT login.',
        encrypted: true,
        sensitivity: SENSITIVITY.CRITICAL,
        providers: ['ringcentral'],
        editable: true,
        deletable: false,
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'jwt',
        inConfig: true,
        displayName: 'RingCentral JWT',
        description: 'Account-level RingCentral JWT credential.',
        encrypted: true,
        sensitivity: SENSITIVITY.CRITICAL,
        providers: ['ringcentral'],
        editable: true,
        deletable: true,
        optional: true,
    },
    {
        field: 'apiKey',
        inConfig: true,
        displayName: '8x8 API key',
        description: '8x8 SMS API key, used directly as the bearer token.',
        encrypted: true,
        sensitivity: SENSITIVITY.CRITICAL,
        providers: ['8x8'],
        editable: true,
        deletable: false,
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'apiSecret',
        inConfig: true,
        displayName: '8x8 API secret',
        description: '8x8 platform API secret, retained for platform API use.',
        encrypted: true,
        sensitivity: SENSITIVITY.CRITICAL,
        providers: ['8x8'],
        editable: true,
        deletable: true,
        optional: true,
    },
    {
        field: 'subAccountId',
        inConfig: true,
        displayName: '8x8 sub-account ID',
        description: '8x8 sub-account the SMS API sends under.',
        encrypted: true,
        sensitivity: SENSITIVITY.INTERNAL,
        providers: ['8x8'],
        editable: true,
        deletable: true,
        optional: true,
    },
    {
        field: 'phoneNumber',
        inConfig: true,
        displayName: 'Configured sender number',
        description: 'Sender number stored on the provider configuration.',
        encrypted: true,
        sensitivity: SENSITIVITY.INTERNAL,
        editable: true,
        deletable: true,
        optional: true,
    },
    {
        field: 'senderId',
        inConfig: true,
        displayName: 'Alphanumeric sender ID',
        description: 'Non-US alphanumeric sender identifier used when no sender number is configured.',
        encrypted: true,
        sensitivity: SENSITIVITY.INTERNAL,
        editable: true,
        deletable: true,
        addable: true,
        optional: true,
    },
    {
        field: 'isSandbox',
        inConfig: true,
        displayName: 'Sandbox mode',
        description: 'When true, the RingCentral adapter targets the sandbox platform instead of production.',
        encrypted: false,
        sensitivity: SENSITIVITY.PUBLIC,
        editable: true,
        deletable: false,
        deleteReason: REASONS.REFERENCED,
        valueType: 'boolean',
    },
    {
        field: 'defaultPhoneNumber',
        displayName: 'Default line',
        description: 'Line used when a send has no explicit or assigned number.',
        encrypted: false,
        sensitivity: SENSITIVITY.INTERNAL,
        editable: false,
        deletable: false,
        editReason: REASONS.READ_ONLY_GENERATED,
        deleteReason: REASONS.REFERENCED,
    },
];

/** `companies/{companyId}/integrations/sms_provider/keychain/{phone}` */
const SMS_KEYCHAIN_FIELDS = [
    {
        field: 'jwt',
        displayName: 'Dedicated line JWT',
        description: 'Per-line RingCentral JWT stored in the private keychain.',
        encrypted: true,
        sensitivity: SENSITIVITY.CRITICAL,
        editable: false,
        deletable: false,
        editReason: 'Replace the line through the Digital Wallet so its JWT is re-verified',
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'clientId',
        displayName: 'Dedicated line client ID',
        description: 'Per-line RingCentral client ID, present only when the line has dedicated credentials.',
        encrypted: true,
        sensitivity: SENSITIVITY.SENSITIVE,
        optional: true,
        editable: false,
        deletable: false,
        editReason: 'Replace the line through the Digital Wallet so its JWT is re-verified',
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'clientSecret',
        displayName: 'Dedicated line client secret',
        description: 'Per-line RingCentral client secret, present only when the line has dedicated credentials.',
        encrypted: true,
        sensitivity: SENSITIVITY.CRITICAL,
        optional: true,
        editable: false,
        deletable: false,
        editReason: 'Replace the line through the Digital Wallet so its JWT is re-verified',
        deleteReason: REASONS.REFERENCED,
    },
];

/** `companies/{companyId}/system_settings/email_config` */
const EMAIL_CONFIG_FIELDS = [
    {
        field: 'smtpHost',
        displayName: 'SMTP host',
        description: 'Outbound mail server hostname.',
        encrypted: false,
        sensitivity: SENSITIVITY.INTERNAL,
        editable: false,
        deletable: false,
        editReason: 'Edit through Company Settings so the connection is re-tested',
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'smtpPort',
        displayName: 'SMTP port',
        description: 'Outbound mail server port.',
        encrypted: false,
        sensitivity: SENSITIVITY.PUBLIC,
        editable: false,
        deletable: false,
        editReason: 'Edit through Company Settings so the connection is re-tested',
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'smtpUser',
        displayName: 'SMTP username',
        description: 'Account the mail server authenticates.',
        encrypted: false,
        sensitivity: SENSITIVITY.INTERNAL,
        editable: false,
        deletable: false,
        editReason: 'Edit through Company Settings so the connection is re-tested',
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'smtpPass',
        displayName: 'SMTP password',
        description: 'Mail server password. Stored in plaintext on an admin-only subcollection by deliberate decision — see functions/saveEmailSettings.js.',
        encrypted: false,
        sensitivity: SENSITIVITY.CRITICAL,
        editable: false,
        deletable: false,
        editReason: 'Edit through Company Settings so the connection is re-tested',
        deleteReason: REASONS.REFERENCED,
    },
];

/** `integrations_index/{pageId}` — connected Facebook Lead Ads page. */
const FACEBOOK_PAGE_FIELDS = [
    {
        field: 'accessToken',
        displayName: 'Facebook page access token',
        description: 'Long-lived page token issued by the Facebook OAuth exchange and used to read submitted leads.',
        encrypted: false,
        sensitivity: SENSITIVITY.CRITICAL,
        editable: false,
        deletable: false,
        editReason: REASONS.READ_ONLY_GENERATED,
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'pageName',
        displayName: 'Facebook page name',
        description: 'Display name of the connected Facebook page.',
        encrypted: false,
        sensitivity: SENSITIVITY.PUBLIC,
        editable: false,
        deletable: false,
        editReason: REASONS.READ_ONLY_GENERATED,
        deleteReason: REASONS.REFERENCED,
    },
];

const COMPANY_TEMPLATES = Object.freeze({
    sms_provider: Object.freeze({
        id: 'sms_provider',
        integration: 'SMS provider',
        docLabel: 'SMS provider configuration',
        fields: SMS_PROVIDER_FIELDS,
    }),
    sms_keychain: Object.freeze({
        id: 'sms_keychain',
        integration: 'SMS dedicated line',
        docLabel: 'SMS dedicated-line keychain',
        fields: SMS_KEYCHAIN_FIELDS,
    }),
    email_config: Object.freeze({
        id: 'email_config',
        integration: 'Company SMTP email',
        docLabel: 'Email configuration',
        fields: EMAIL_CONFIG_FIELDS,
    }),
    facebook_page: Object.freeze({
        id: 'facebook_page',
        integration: 'Facebook Lead Ads',
        docLabel: 'Connected Facebook page',
        fields: FACEBOOK_PAGE_FIELDS,
    }),
});

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const GLOBAL_ENTRIES = Object.freeze(
    [
        ...BROWSER_ENTRIES,
        ...FUNCTIONS_ENTRIES,
        ...SECRET_MANAGER_ENTRIES,
        ...GITHUB_ENTRIES,
        ...FIREBASE_ENTRIES,
        ...OPS_ENTRIES,
        ...REPO_ENTRIES,
    ].map((entry) => Object.freeze({ ...entry, id: `${entry.source}:${entry.key}` })),
);

const GLOBAL_BY_ID = new Map(GLOBAL_ENTRIES.map((entry) => [entry.id, entry]));

/**
 * Keys registered here that no repository file references by name.
 *
 * Each needs a stated reason, because an unreferenced registry row is otherwise
 * indistinguishable from a fabricated one.
 */
const UNREFERENCED_BY_DESIGN = Object.freeze({
    'firebase.default_project': 'Synthetic row describing .firebaserc, which is not an environment variable.',
    'signing.envelope_token_store': 'Synthetic row describing the per-envelope signing token store.',
});

/**
 * Vite built-ins on `import.meta.env` that are not SafeHaul configuration and
 * are deliberately excluded from the inventory.
 */
const VITE_BUILTINS = Object.freeze(['DEV', 'PROD', 'MODE', 'BASE_URL', 'SSR', 'VITEST']);

/** Prefixes and names an operator may never introduce through the vault. */
const RESERVED_KEY_PATTERNS = Object.freeze([
    /^FIREBASE_/i,
    /^FIREBASE$/i,
    /^GOOGLE_/i,
    /^GCLOUD_/i,
    /^GCP_/i,
    /^GITHUB_/i,
    /^NODE_/i,
    /^NPM_/i,
    /^npm_/,
    /^K_(SERVICE|REVISION|CONFIGURATION)$/,
    /^(PATH|HOME|USER|SHELL|PWD|LANG|LC_ALL|TMPDIR|TEMP|TMP|HOSTNAME|TERM)$/i,
    /^X_GOOGLE_/i,
    /^FUNCTION_/i,
    /^FUNCTIONS_/i,
]);

const KEY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{1,63}$/;

/**
 * Validates a key name an operator wants to add.
 *
 * @param {string} key
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateNewKeyName(key) {
    if (typeof key !== 'string' || !KEY_NAME_PATTERN.test(key)) {
        return {
            ok: false,
            reason: 'Key names must be 2-64 characters, start with a letter, and contain only letters, digits and underscores.',
        };
    }
    for (const pattern of RESERVED_KEY_PATTERNS) {
        if (pattern.test(key)) {
            return { ok: false, reason: `"${key}" is reserved by the platform and cannot be defined here.` };
        }
    }
    return { ok: true };
}

/** @returns {object|undefined} the frozen global entry with this id. */
function getGlobalEntry(id) {
    return GLOBAL_BY_ID.get(id);
}

/** @returns {object|undefined} the company template with this id. */
function getCompanyTemplate(templateId) {
    return COMPANY_TEMPLATES[templateId];
}

/** @returns {object|undefined} the field definition inside a company template. */
function getCompanyField(templateId, field) {
    const template = getCompanyTemplate(templateId);
    if (!template) return undefined;
    return template.fields.find((candidate) => candidate.field === field);
}

module.exports = {
    AVAILABILITY,
    CATEGORIES,
    COMPANY_TEMPLATES,
    GLOBAL_ENTRIES,
    REASONS,
    RESERVED_KEY_PATTERNS,
    SENSITIVITY,
    SOURCES,
    UNREFERENCED_BY_DESIGN,
    VITE_BUILTINS,
    getCompanyField,
    getCompanyTemplate,
    getGlobalEntry,
    validateNewKeyName,
};
