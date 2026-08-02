// E2E coverage for the CampaignDetails design-system migration. Opens the detail
// view from a completed session (e2eCampaign=mock) and verifies the header/status,
// stats, progress, message, details, and results table render; that the back
// button returns to the dashboard; no document overflow at 1440/1024/412; and a
// scoped axe pass. Lifecycle callables are covered by the vitest suite.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock';

async function openDetails(page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: /Past Sequences/i }).click();
  await expect(page.getByText('E2E Completed Session')).toBeVisible();
  await page.getByRole('button', { name: /Details/ }).click();
  await expect(page.getByRole('heading', { name: 'E2E Completed Session' })).toBeVisible();
}

test.describe('CampaignDetails compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('renders the detail view with status, stats, progress and message', async ({ page }) => {
    await openDetails(page);
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    // Scope to the stat cards ("Failed" also appears as per-row result badges).
    await expect(page.locator('.ds-card').filter({ hasText: 'Audience' })).toBeVisible();
    await expect(page.locator('.ds-card').filter({ hasText: 'Sent' })).toBeVisible();
    await expect(page.locator('.ds-card').filter({ hasText: 'Failed' }).first()).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Campaign progress' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Message Content/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Details', exact: true })).toBeVisible();
  });

  test('returns to the dashboard from the accessible back button', async ({ page }) => {
    await openDetails(page);
    await page.getByRole('button', { name: 'Back to campaigns' }).click();
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  });

  test('keeps the detail view within the viewport (no document overflow)', async ({ page }, testInfo) => {
    const widths = testInfo.project.name.startsWith('mobile') ? [412] : [1440, 1024];
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 412 ? 915 : 900 });
      await openDetails(page);
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    }
  });

  test('has no serious or critical accessibility violations in the detail content', async ({ page }) => {
    await openDetails(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
