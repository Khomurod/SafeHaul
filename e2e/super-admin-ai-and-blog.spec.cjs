// Browser coverage for the two new Super Admin views: "AI Integrations" and
// "Blog Posts".
//
// Under `VITE_E2E_TEST_MODE=1` the app is pointed at a placeholder Firebase
// project and Firestore is deliberately unreachable, so the list callables
// cannot succeed. What is reachable — and what this spec asserts — is the pages
// themselves: navigation, headings, the security notice, the summary cards, the
// announced load failure with a working retry, keyboard operability, axe, and
// the absence of horizontal overflow at four widths.
//
// Row-level behaviour (masking, one-at-a-time reveal, the 30-second auto-hide,
// typed-confirmation delete, re-authentication, provider ordering, the retired
// provider's missing actions, blog deletion and focus restoration) is proven by
// `AiIntegrationsView.contract.test.jsx` and `BlogPostsView.contract.test.jsx`,
// which can supply rows deterministically. Asserting it here would require a
// backend this environment must never have.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SUPER_ADMIN_URL = '/super-admin?e2eAuth=super_admin';

async function openView(page, navLabel, heading) {
  await page.goto(SUPER_ADMIN_URL);
  await expect(page.getByRole('heading', { name: 'Super Admin', level: 1 })).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole('navigation', { name: 'Super Admin sections' })
    .getByRole('button', { name: navLabel })
    .click();
  await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible({ timeout: 20_000 });
}

const openAi = (page) => openView(page, 'AI Integrations', 'AI Integrations');
const openBlog = (page) => openView(page, 'Blog Posts', 'Blog Posts');

async function expectNoHorizontalOverflow(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

const WIDTHS = [
  { width: 1440, height: 900, label: '1440' },
  { width: 1024, height: 768, label: '1024' },
  { width: 768, height: 1024, label: '768' },
  { width: 412, height: 915, label: '412' },
];

test.describe('Super Admin AI Integrations', () => {
  test.describe.configure({ timeout: 120_000 });

  test('is reachable from the Super Admin navigation', async ({ page }) => {
    await openAi(page);
    await expect(page.getByRole('heading', { name: 'AI Integrations', level: 2 })).toBeVisible();
  });

  test('does not introduce a second page-level h1', async ({ page }) => {
    await openAi(page);
    // The Super Admin masthead owns the single h1.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('states up front how credentials are handled', async ({ page }) => {
    await openAi(page);
    await expect(page.getByRole('heading', { name: 'How credentials are handled' })).toBeVisible();
    await expect(page.getByText(/masked by default and revealed one at a time/)).toBeVisible();
    await expect(page.getByText(/clears after 30 seconds/)).toBeVisible();
    await expect(page.getByText(/take effect without a deployment/)).toBeVisible();
  });

  test('shows the provider summary cards', async ({ page }) => {
    await openAi(page);
    const summary = page.getByLabel('AI provider summary');
    for (const label of ['Supported providers', 'Configured', 'Active in routing', 'In cooldown', 'Retired by vendor']) {
      await expect(summary.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('separates the Research & Media subsection', async ({ page }) => {
    await openAi(page);
    await expect(page.getByRole('heading', { name: 'Research & Media' })).toBeVisible();
    await expect(page.getByText(/approved SafeHaul illustration rather than an unlicensed image/)).toBeVisible();
  });

  test('announces the load failure and offers a retry when the backend is unreachable', async ({ page }) => {
    await openAi(page);
    const retry = page.getByRole('button', { name: /Try again/i });
    await expect(retry.first()).toBeVisible({ timeout: 60_000 });
    await retry.first().click();
    // Retrying must not blank the page or throw.
    await expect(page.getByRole('heading', { name: 'AI Integrations', level: 2 })).toBeVisible();
  });

  test('never renders anything resembling a credential', async ({ page }) => {
    await openAi(page);
    const body = await page.locator('body').innerText();
    // No provider token prefixes, and no bearer header, may appear on a page
    // that has not performed an audited reveal.
    expect(body).not.toMatch(/\b(gsk_|sk-|hf_|csk-|ghp_)/);
    expect(body).not.toMatch(/Bearer\s+\S/);
  });

  test('is operable by keyboard from the navigation', async ({ page }) => {
    await page.goto(SUPER_ADMIN_URL);
    await expect(page.getByRole('heading', { name: 'Super Admin', level: 1 })).toBeVisible({ timeout: 20_000 });

    const navButton = page
      .getByRole('navigation', { name: 'Super Admin sections' })
      .getByRole('button', { name: 'AI Integrations' });
    await navButton.focus();
    await expect(navButton).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'AI Integrations', level: 2 })).toBeVisible({ timeout: 20_000 });
  });

  for (const { width, height, label } of WIDTHS) {
    test(`has no horizontal overflow at ${label}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openAi(page);
      await expectNoHorizontalOverflow(page, `AI Integrations @ ${label}`);
    });
  }

  test('@a11y has no serious or critical axe violations', async ({ page }) => {
    await openAi(page);
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(blocking.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});

test.describe('Super Admin Blog Posts', () => {
  test.describe.configure({ timeout: 120_000 });

  test('is reachable from the Super Admin navigation', async ({ page }) => {
    await openBlog(page);
    await expect(page.getByRole('heading', { name: 'Blog Posts', level: 2 })).toBeVisible();
  });

  test('does not introduce a second page-level h1', async ({ page }) => {
    await openBlog(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('explains the publication cadence and what deletion does', async ({ page }) => {
    await openBlog(page);
    await expect(page.getByText(/Three articles\s+publish each day/)).toBeVisible();
    await expect(page.getByText(/the feed and the sitemap immediately/)).toBeVisible();
  });

  test('stays a list rather than a content-management screen', async ({ page }) => {
    await openBlog(page);
    // No editor, no approval queue, no publish/unpublish workflow.
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /approve/i })).toHaveCount(0);
  });

  test('offers refresh and the manual publication check', async ({ page }) => {
    await openBlog(page);
    await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Run today’s publication check/i })).toBeVisible();
  });

  test('announces the load failure and offers a retry when the backend is unreachable', async ({ page }) => {
    await openBlog(page);
    const retry = page.getByRole('button', { name: /Try again/i });
    await expect(retry.first()).toBeVisible({ timeout: 60_000 });
    await retry.first().click();
    await expect(page.getByRole('heading', { name: 'Blog Posts', level: 2 })).toBeVisible();
  });

  for (const { width, height, label } of WIDTHS) {
    test(`has no horizontal overflow at ${label}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openBlog(page);
      await expectNoHorizontalOverflow(page, `Blog Posts @ ${label}`);
    });
  }

  test('@a11y has no serious or critical axe violations', async ({ page }) => {
    await openBlog(page);
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(blocking.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
