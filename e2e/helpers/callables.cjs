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

module.exports = { API_KEYS, BLOG_POSTS, BLOG_RUNS, WEBSITE_LEADS, serveCallables };
