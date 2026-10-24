// Answers a page's Cloud Functions callables at the network edge, as the
// Functions endpoint would, so a screen whose records come from a callable
// shows them in a build that cannot reach the server.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/** Answers each named callable with `result`. */
async function serveCallables(page, callables) {
  for (const [name, result] of Object.entries(callables)) {
    await page.route(`**/${name}`, (route) => (route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ result }) })));
  }
}

/**
 * Two API keys as `listCompanyApiKeys` returns them: one on, with every
 * permission, and one turned off. Made up; the ids are not keys.
 */
const API_KEYS = Object.freeze({
  maxActiveKeys: 5,
  keys: [
    {
      keyId: '0123456789abcdef', name: 'Artificial TMS', prefix: 'shk_0123456789abcdef_…',
      scopes: ['applications:read', 'documents:read', 'ssn:read'], createdAt: '2026-10-01T15:00:00.000Z',
      createdByName: 'Artificial Admin', lastUsedAt: '2026-10-09T13:20:00.000Z', revokedAt: null,
    },
    {
      keyId: 'fedcba9876543210', name: 'Old payroll', prefix: 'shk_fedcba9876543210_…',
      scopes: ['applications:read'], createdAt: '2026-09-01T15:00:00.000Z',
      createdByName: 'Artificial Admin', lastUsedAt: null, revokedAt: '2026-10-05T12:00:00.000Z',
    },
  ],
});

/**
 * The website-lead archive as `listLandingLeads` returns it: a qualified lead
 * with long names, a contact-only lead whose delivery failed, and one never
 * sent. Every person, company and address is made up.
 */
const WEBSITE_LEADS = Object.freeze({
  leads: [
    {
      id: 'lead-1', createdAt: '2026-10-21T15:05:00.000Z', fullName: 'Marisol Quintero-Abernathy',
      workEmail: 'marisol.quintero-abernathy@artificial-freight.example', phone: '(555) 010-2211',
      companyName: 'Artificial Freight Lines of the Southwest', companySize: '51-200', stage: 'qualified',
      delivery: { status: 'delivered' },
    },
    {
      id: 'lead-2', createdAt: '2026-10-19T09:40:00.000Z', fullName: 'Dev Patel', workEmail: 'dev@example.test',
      stage: 'contact', delivery: { status: 'failed' },
    },
    {
      id: 'lead-3', createdAt: '2026-10-02T20:15:00.000Z', fullName: 'Ola Nordmann', workEmail: 'ola@example.test',
      companyName: 'Fjord Haulage', companySize: '1-10', stage: 'qualified', delivery: { status: 'disabled' },
    },
  ],
});

/**
 * Three articles as `listBlogPosts` returns them, one with a long title and one
 * removed, and an empty run ledger as `listBlogRuns` returns it. Made up.
 */
const BLOG_POSTS = Object.freeze({
  posts: [
    {
      id: '2026-10-23_industry-news', slug: 'hours-of-service-changes-before-the-winter-peak',
      title: 'Hours-of-service changes every dispatcher should know before the winter peak',
      publicationDate: '2026-10-23', status: 'published',
    },
    {
      id: '2026-10-22_recruitment', slug: 'why-drivers-stay', title: 'Why drivers stay: five retention habits',
      publicationDate: '2026-10-22', status: 'published',
    },
    {
      id: '2026-10-20_safehaul-education', slug: 'removed-article', title: 'An article that was removed',
      publicationDate: '2026-10-20', status: 'deleted',
    },
  ],
});
const BLOG_RUNS = Object.freeze({ runs: [], truncated: false, unavailable: false, retentionDays: 30 });

/**
 * Three AI transactions as `listAiTelemetry` returns them: a CDL read that
 * needed two fallbacks, an E-Doc analysis the vendor refused (the longest
 * outcome label), and a fact-check that refused an article. Made up.
 */
const AI_TELEMETRY = Object.freeze({
  truncated: false,
  windowSize: 3,
  entries: [
    {
      id: 't1', transactionId: 'txn-cdl', taskType: 'cdl_extraction', providerId: 'groq', model: 'qwen/qwen3.6-27b',
      outcome: 'success', latencyMs: 2992, fallbackCount: 2, timestamp: '2026-10-21T15:14:00.000Z', attempts: [],
    },
    {
      id: 't2', transactionId: 'txn-edoc', taskType: 'edoc_field_placement', providerId: 'gemini', model: 'gemini-3.7-flash',
      outcome: 'failure', category: 'provider_request_rejected', latencyMs: 812, fallbackCount: 3,
      timestamp: '2026-10-21T14:02:00.000Z', attempts: [],
    },
    {
      id: 't3', transactionId: 'txn-check', taskType: 'article_fact_check', providerId: 'mistral', model: 'mistral-large-latest',
      outcome: 'success', verdict: 'unsupported', latencyMs: 15400, fallbackCount: 0,
      timestamp: '2026-10-21T12:00:00.000Z', attempts: [],
    },
  ],
});

/**
 * Four rows as `listEnvironmentAndIntegrations` returns them: a configured
 * secret that needs a deployment (two status badges), a company credential
 * that can be edited, a missing optional value, and a CI secret that cannot be
 * read back. Every key and company is made up; values are always masked.
 */
const envEntry = (over) => ({
  category: 'infrastructure-security', integration: 'SafeHaul platform', scope: 'global',
  source: 'secret-manager', sensitivity: 'critical', description: 'A made-up configuration entry.',
  availability: 'server-runtime', requiresDeployment: false, optional: false,
  permissions: { revealable: true, editable: false, replaceable: false, addable: false, deletable: false, testable: false },
  restrictions: {
    edit: 'Managed by deployment', replace: 'Managed by deployment',
    add: 'Source does not support adding keys here', delete: 'Source does not support deletion',
  },
  maskedValue: '********', status: 'configured', statusResolvedBy: 'server', unavailableReason: null,
  companyId: null, companyName: null, lastUpdated: null, updatedBy: null,
  ...over,
});
const ENVIRONMENT_INVENTORY = Object.freeze({
  generatedAt: 1, companyError: null, recentActivity: [],
  entries: [
    envEntry({
      id: 'secret-manager:ARTIFICIAL_ENCRYPTION_MASTER_KEY', key: 'ARTIFICIAL_ENCRYPTION_MASTER_KEY',
      displayName: 'Artificial encryption master key', requiresDeployment: true,
    }),
    envEntry({
      id: 'company:co-north:sms_provider:clientSecret', key: 'clientSecret', displayName: 'SMS provider client secret',
      category: 'company-integration', integration: 'SMS provider', scope: 'company', companyId: 'co-north',
      companyName: 'Northern Plains Refrigerated Transport', source: 'firestore-encrypted', availability: 'firestore-encrypted',
      permissions: { revealable: true, editable: true, replaceable: true, addable: false, deletable: true, testable: false },
      restrictions: { edit: null, replace: null, add: 'Source does not support adding keys here', delete: null },
      lastUpdated: Date.parse('2026-10-20T15:00:00Z'), updatedBy: 'artificial.admin@example.test',
    }),
    envEntry({
      id: 'functions-env:ARTIFICIAL_OPTIONAL_WEBHOOK_URL', key: 'ARTIFICIAL_OPTIONAL_WEBHOOK_URL',
      displayName: 'Artificial optional webhook URL', category: 'functions-env', source: 'functions-env',
      sensitivity: 'internal', status: 'missing', optional: true,
      permissions: { revealable: false, editable: false, replaceable: false, addable: false, deletable: false, testable: false },
    }),
    envEntry({
      id: 'github-actions-secret:ARTIFICIAL_CI_TOKEN', key: 'ARTIFICIAL_CI_TOKEN', displayName: 'Artificial CI token',
      category: 'github-actions', source: 'github-actions-secret', availability: 'not-retrievable', status: 'unknown',
      permissions: { revealable: false, editable: false, replaceable: false, addable: false, deletable: false, testable: false },
    }),
  ],
});

// A dry run of `backfillCompanyStats` for a made-up company: fourteen days, so
// the preview overflows its 256px cap and scrolls under its header.
const BACKFILL_PREVIEW = Object.freeze({
  dryRun: true, companyId: 'e2e-company-artificial', totalActivitiesProcessed: 1284,
  legacyCount: 312, modernCount: 972, daysWithStats: 14,
  preview: Array.from({ length: 14 }, (_, i) => ({
    dateKey: `2026-10-${String(i + 1).padStart(2, '0')}`,
    totalDials: 40 + ((i * 37) % 90), connected: 12 + ((i * 11) % 30), userCount: 2 + (i % 5),
  })),
});

module.exports = {
  AI_TELEMETRY, API_KEYS, BACKFILL_PREVIEW, BLOG_POSTS, BLOG_RUNS, ENVIRONMENT_INVENTORY, WEBSITE_LEADS,
  serveCallables,
};
