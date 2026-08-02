// E2E coverage for the CampaignCard design-system migration. Uses the dashboard's
// e2eCampaign=mock seed (a draft + a completed session) to verify the status
// badge, the accessible options menu, the keyboard-focusable Details/View Report
// controls, responsive overflow at 1440/1024/412, and a scoped axe pass.
// Destructive actions are not triggered here (they hit Firestore/callables via
// the dashboard); their callbacks are covered by the vitest suite.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock';

async function openCampaigns(page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('E2E Seed Campaign')).toBeVisible();
}

test.describe('CampaignCard compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('renders the draft card with a status badge and an accessible options menu', async ({ page }) => {
    await openCampaigns(page);

    await expect(page.getByText('Draft', { exact: true })).toBeVisible();

    const trigger = page.getByRole('button', { name: 'Campaign options' }).first();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menuitem', { name: 'Delete Campaign' })).toBeVisible();

    // Escape closes the menu without deleting anything.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByText('E2E Seed Campaign')).toBeVisible();
  });

  test('keeps the options trigger keyboard-focusable with visible focus', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCampaigns(page);

    const trigger = page.getByRole('button', { name: 'Campaign options' }).first();
    await trigger.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    const focus = await trigger.evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focus.boxShadow !== 'none' || focus.outline !== 'none').toBe(true);
  });

  test('shows View Report on a completed session in Past Sequences', async ({ page }) => {
    await openCampaigns(page);
    await page.getByRole('tab', { name: /Past Sequences/i }).click();
    await expect(page.getByText('E2E Completed Session')).toBeVisible();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View Report' })).toBeVisible();
  });

  test('keeps the card grid within the viewport on desktop and tablet', async ({ page }, testInfo) => {
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

  test('has no serious or critical accessibility violations in the card (menu open)', async ({ page }) => {
    await openCampaigns(page);
    await page.getByRole('button', { name: 'Campaign options' }).first().click();

    // Scoped to the migrated card. The surrounding dashboard (stat labels, tabs)
    // is legacy markup not part of this slice and has pre-existing contrast
    // findings tracked for the broader Campaigns dashboard migration.
    const { violations } = await new AxeBuilder({ page }).include('article.ds-card').analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
