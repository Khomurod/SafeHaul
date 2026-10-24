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

module.exports = { API_KEYS, serveCallables };
