// Browser coverage for the Super Admin "Environment & Integrations" vault.
//
// Under `VITE_E2E_TEST_MODE=1` the app is pointed at a placeholder Firebase
// project and Firestore is deliberately unreachable, so the inventory callable
// cannot succeed. What is reachable — and what this spec asserts — is the page
// itself: its heading and security notice, the summary cards, the labelled
// search and filter controls, the announced load failure with a working retry,
// keyboard operability, axe, and the absence of horizontal overflow at four
// widths.
//
// Row-level behaviour (masking, reveal, the 30-second auto-hide, disabled action
// explanations, typed-confirmation delete, re-authentication) is proven by
// `src/features/super-admin/views/EnvironmentIntegrationsView.contract.test.jsx`,
// which can supply inventory rows deterministically. Asserting it here would
// require a backend this environment must never have.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SUPER_ADMIN_URL = '/super-admin?e2eAuth=super_admin';

async function openVault(page) {
  await page.goto(SUPER_ADMIN_URL);
  await expect(page.getByRole('heading', { name: 'Super Admin', level: 1 })).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole('navigation', { name: 'Super Admin sections' })
    .getByRole('button', { name: 'Environment & Integrations' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Environment & Integrations', level: 2 }),
  ).toBeVisible({ timeout: 20_000 });
}

async function expectNoHorizontalOverflow(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe('Super Admin Environment & Integrations', () => {
  test.describe.configure({ timeout: 120_000 });

  test('states up front how values are handled', async ({ page }) => {
    await openVault(page);
    await expect(page.getByRole('heading', { name: 'How values are handled' })).toBeVisible();
    await expect(page.getByText(/A revealed value clears after 30 seconds/)).toBeVisible();
    await expect(page.getByText(/GitHub Actions never returns a stored secret/)).toBeVisible();
  });

  test('shows the five summary cards', async ({ page }) => {
    await openVault(page);
    const summary = page.getByLabel('Inventory summary');
    for (const label of ['Total keys', 'Configured', 'Missing', 'Protected', 'Needs deployment']) {
      await expect(summary.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('gives every filter control an accessible name', async ({ page }) => {
    await openVault(page);
    await expect(page.getByLabel('Search keys, integrations and companies')).toBeVisible();
    for (const label of ['Category', 'Source', 'Integration', 'Scope', 'Company', 'Status', 'Writability']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
  });

  test('announces the load failure and offers a retry when the backend is unreachable', async ({ page }) => {
    await openVault(page);
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('The configuration inventory could not be loaded.')).toBeVisible();
    // Retry must be operable, not decorative.
    await retry.click();
    await expect(retry).toBeVisible({ timeout: 60_000 });
  });

  test('is keyboard operable and keeps focus visible', async ({ page }) => {
    await openVault(page);
    const search = page.getByLabel('Search keys, integrations and companies');
    await search.focus();
    await expect(search).toBeFocused();
    await page.keyboard.type('encryption');
    await expect(search).toHaveValue('encryption');

    await page.getByLabel('Source', { exact: true }).focus();
    await expect(page.getByLabel('Source', { exact: true })).toBeFocused();
  });

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await openVault(page);
    const { violations } = await new AxeBuilder({ page }).include('main').analyze();
    const severe = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}]`);
    expect(severe, 'Environment & Integrations axe').toEqual([]);
  });

  test('does not overflow horizontally at 1440, 1024, 768 or 412px', async ({ page }) => {
    for (const width of [1440, 1024, 768, 412]) {
      await page.setViewportSize({ width, height: 900 });
      await openVault(page);
      await expectNoHorizontalOverflow(page, `${width}px`);
    }
  });
});
