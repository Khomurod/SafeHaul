/**
 * GitHub, Firebase, deployment tooling and repository configuration —
 * the four sources SafeHaul does not itself store values in.
 */

const {
    CATEGORIES, SOURCES, AVAILABILITY, SENSITIVITY, REASONS, readOnly, PROTECTED, PLATFORM,
} = require('./vocabulary');

// ---------------------------------------------------------------------------
// 4. GitHub's automatic per-run token
//
// SafeHaul stores no application or deployment secrets in GitHub. GITHUB_TOKEN
// is minted automatically for one workflow run and cannot be moved elsewhere.
// ---------------------------------------------------------------------------

const GITHUB_SECRET_KEYS = [
    ['GITHUB_TOKEN', 'GitHub Actions', SENSITIVITY.SENSITIVE, 'Ephemeral token GitHub mints per workflow run; used by the CI planner to read attestations, by the release-health reporter, by the promotion workflow, and by the secret scan to ask (read-only) which ancestor commit last carried a fully validated release.'],
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
    // Not stored anywhere. Workload Identity Federation mints this inside the
    // deploy job so the release step can read back the Hosting version it just
    // published; it expires with the run. Listed because the vault's inventory
    // guard is only meaningful if it is complete, and marked SENSITIVE because
    // it is a live credential for the run's lifetime — unlike the rest of this
    // group, which are plain settings.
    ['GOOGLE_ACCESS_TOKEN', 'Google deploy access token', 'Short-lived OAuth access token minted by Workload Identity Federation during the deploy workflow, used to read the deployed Firebase Hosting version ID. Never stored or retrievable.', ['scripts/read-hosting-release.mjs', '.github/workflows/main.yml'], { sensitivity: SENSITIVITY.SENSITIVE }],
    ['RELEASE_SHA', 'Release commit SHA', 'Commit a release is being recorded for. Passed explicitly because a production promotion is dispatched from main but releases the candidate commit, so GITHUB_SHA would name the wrong thing.', ['scripts/record-release.mjs', '.github/workflows/main.yml', '.github/workflows/promote-production.yml']],
    // The secret scanner reads the event itself rather than trusting an action
    // to infer a range from it, so the variables GitHub uses to describe a run
    // are SafeHaul configuration now. See scripts/secret-scan.mjs.
    ['GITHUB_EVENT_NAME', 'Workflow event name', 'Event that triggered the run (push, pull_request, workflow_dispatch). Decides which baseline the secret scan compares against.', ['scripts/secret-scan.mjs', '.github/workflows/main.yml']],
    ['GITHUB_EVENT_PATH', 'Workflow event payload path', 'Path to the JSON payload of the triggering event. The secret scan reads the pull request base SHA and the push before-SHA from it.', ['scripts/secret-scan.mjs']],
    ['GITHUB_REPOSITORY', 'Workflow repository slug', 'owner/repo of the run, supplied by GitHub Actions. The secret scan uses it to ask which ancestor commit last carried a fully validated release, which is the baseline it compares against.', ['scripts/secret-scan.mjs']],
    ['GITHUB_STEP_SUMMARY', 'Job summary file', 'File GitHub renders as the job summary. The secret scan and the history audit write their redacted verdicts there.', ['scripts/secret-scan.mjs', 'scripts/secret-history-audit.mjs']],
    ['SECRET_SCAN_BASE', 'Secret-scan baseline override', 'Optional commit to use as the secret-scan baseline, exposed as a workflow_dispatch input. Validated: it must be a hexadecimal commit SHA (abbreviated is fine, it is resolved to its full form before anything compares it), exist in the clone, be an ancestor of the head being scanned, not be the head itself, and itself carry a fully validated release. Exists to reach past the automatic walk by naming an older release known to be good.', ['scripts/secret-scan.mjs', '.github/workflows/main.yml']],
    ['SECRET_SCAN_REPORT_DIR', 'Secret-scan report directory', 'Directory the secret scan writes its redacted findings report to for upload as an artifact. Rule, file, line and commit only — never a value.', ['scripts/secret-scan.mjs', '.github/workflows/main.yml']],
    ['SECRET_HISTORY_REPORT_DIR', 'History audit report directory', 'Directory the full-history audit writes its redacted inventory to for upload as an artifact.', ['scripts/secret-history-audit.mjs', '.github/workflows/secret-history-audit.yml']],
    ['GITLEAKS_BIN', 'Gitleaks binary override', 'Path to an already-present gitleaks binary. Lets the test suite and a developer run the real scanner without re-downloading it; CI leaves it unset so the pinned, digest-verified release is fetched.', ['scripts/secret-scan/gitleaks.mjs']],
].map(([key, displayName, description, consumers, overrides = {}]) => ({
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
    ...overrides,
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

module.exports = { GITHUB_ENTRIES, FIREBASE_ENTRIES, OPS_ENTRIES, REPO_ENTRIES };
