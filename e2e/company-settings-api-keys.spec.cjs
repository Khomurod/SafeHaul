// Settings → API Keys and the API guide, in a real browser. The three key
// callables are answered at the network edge (`page.route`), as the app calls
// them, so the flow is deterministic and no key is made anywhere. Vitest
// (`ApiKeysTab.test.jsx`) pins what each action asks the server; this spec
// proves the page is reachable, accessible, shows a key once and fits a phone.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';
// Built at run time: a key-shaped literal in source is what the secret scan
// is for, and this one is made up.
const NEW_KEY = ['shk', '0123456789abcdef', 'A'.repeat(43)].join('_');
const KEYS = [
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
];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

async function answerCallables(page) {
  const answers = {
    listCompanyApiKeys: { keys: KEYS, maxActiveKeys: 5 },
    createCompanyApiKey: { keyId: '0123456789abcdef', key: NEW_KEY, name: 'Artificial TMS', prefix: 'shk_0123456789abcdef_…', scopes: ['applications:read'] },
    revokeCompanyApiKey: { keyId: '0123456789abcdef', revoked: true, alreadyRevoked: false },
  };
  for (const [name, result] of Object.entries(answers)) {
    await page.route(new RegExp(`/${name}$`), (route) => (route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ result }) })));
  }
}

async function openApiKeys(page) {
  await answerCallables(page);
  await page.goto(SETTINGS_URL);
  await page.getByRole('button', { name: 'API Keys' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'API Keys' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'API keys' }).getByText('Artificial TMS')).toBeVisible();
}

async function expectNoHorizontalOverflow(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe('Company Settings API Keys', () => {
  test.describe.configure({ timeout: 90_000 });

  test('lists the keys, and only a key that is on can be turned off', async ({ page }) => {
    await openApiKeys(page);
    await expect(page.getByRole('button', { name: 'Turn off Artificial TMS' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Turn off Old payroll/ })).toHaveCount(0);
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations).toEqual([]);
  });

  test('shows a new key once, and only Done closes that dialog', async ({ page }) => {
    await openApiKeys(page);
    await page.getByRole('button', { name: 'Create key' }).click();
    const form = page.getByRole('dialog', { name: 'Create an API key' });
    await form.getByLabel(/Key name/).fill('Artificial TMS');
    await form.getByRole('button', { name: 'Create key' }).click();

    const shown = page.getByRole('dialog', { name: 'Copy your new key' });
    await expect(shown.getByLabel('Your API key')).toHaveValue(NEW_KEY);
    await page.keyboard.press('Escape');
    await expect(shown).toBeVisible();
    await shown.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.content()).not.toContain(NEW_KEY);
  });

  test('asks before turning a key off', async ({ page }) => {
    await openApiKeys(page);
    await page.getByRole('button', { name: 'Turn off Artificial TMS' }).click();
    const confirm = page.getByRole('dialog', { name: 'Turn off “Artificial TMS”?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  for (const width of [412, 1440]) {
    test(`fits a ${width}px screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openApiKeys(page);
      await expectNoHorizontalOverflow(page, `API keys at ${width}px`);
    });
  }

  test('links to the API guide, which anyone can open', async ({ page }) => {
    await openApiKeys(page);
    await page.getByRole('link', { name: 'SafeHaul API guide' }).click();
    await expect(page).toHaveURL(/\/developers\/api$/);
    await expect(page.getByRole('heading', { level: 1, name: 'SafeHaul API' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'GET /v1/submissions' })).toBeVisible();
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations).toEqual([]);
    await expectNoHorizontalOverflow(page, 'API guide');
  });
});
