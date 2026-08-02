// E2E coverage for the Campaigns dashboard shell design-system migration. Uses
// the dashboard's e2eCampaign=mock seed (a draft + a completed session) to
// verify the migrated header, primary action, MetricCard stats, the accessible
// WAI-ARIA tablist (selection + keyboard), responsive overflow at 1440/1024/412,
// and an axe pass scoped to the migrated dashboard shell (the previous 10px stat
// labels and their contrast are the defect this slice fixes). The CampaignCard
// internals and destructive actions are covered by campaign-card.spec.cjs and
// the vitest suite.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock';

async function openCampaigns(page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('E2E Seed Campaign')).toBeVisible();
}

test.describe('Campaigns dashboard shell slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('renders the header, primary action, and MetricCard stats', async ({ page }) => {
    await openCampaigns(page);

    await expect(page.getByRole('button', { name: /Create Campaign/i })).toBeVisible();

    // Seed: one completed session (processedCount 12) → live 0, outreach 12.
    const live = page.locator('#campaigns-stat-live');
    const outreach = page.locator('#campaigns-stat-outreach');
    await expect(live).toContainText('Live Campaigns');
    await expect(live).toContainText('0');
    await expect(outreach).toContainText('Total Outreach');
    await expect(outreach).toContainText('12');
  });

  test('exposes an accessible tablist and switches selection', async ({ page }) => {
    await openCampaigns(page);

    const tablist = page.getByRole('tablist', { name: 'Campaign views' });
    await expect(tablist).toBeVisible();

    const draftsTab = page.getByRole('tab', { name: /Drafts/i });
    const historyTab = page.getByRole('tab', { name: /Past Sequences/i });

    await expect(draftsTab).toHaveAttribute('aria-selected', 'true');
    await expect(historyTab).toHaveAttribute('aria-selected', 'false');

    await historyTab.click();
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');
    await expect(draftsTab).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByText('E2E Completed Session')).toBeVisible();
  });

  test('moves tab selection with the arrow keys and shows visible focus', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCampaigns(page);

    const draftsTab = page.getByRole('tab', { name: /Drafts/i });
    const historyTab = page.getByRole('tab', { name: /Past Sequences/i });

    await draftsTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(historyTab).toBeFocused();
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');

    const focus = await historyTab.evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focus.boxShadow !== 'none' || focus.outline !== 'none').toBe(true);
  });

  test('keeps the dashboard within the viewport on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await openCampaigns(page);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a mobile layout without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openCampaigns(page);
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious/critical or contrast violations in the migrated shell', async ({ page }) => {
    await openCampaigns(page);

    // Scoped to the migrated dashboard shell (header, stat cards, tablist, grid).
    // Fixing the former 10px stat labels and their contrast is a goal of this
    // slice, so contrast findings here are asserted away explicitly.
    const { violations } = await new AxeBuilder({ page }).include('.ds-page-container').analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });
});
