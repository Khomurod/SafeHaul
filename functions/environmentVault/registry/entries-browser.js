/**
 * Browser / build variables (`import.meta.env.VITE_*`).
 */

const {
    CATEGORIES, SOURCES, AVAILABILITY, SENSITIVITY, REASONS, readOnly,
} = require('./vocabulary');

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

module.exports = { BROWSER_ENTRIES };
