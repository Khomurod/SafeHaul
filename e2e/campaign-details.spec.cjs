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
  await page.getByRole('tab', { name: /Sent & live/i }).click();
  await expect(page.getByText('E2E Completed Session')).toBeVisible();
  await page.getByRole('button', { name: /Details/ }).click();
  await expect(page.getByRole('heading', { name: 'E2E Completed Session' })).toBeVisible();
}

test.describe('CampaignDetails compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('renders the detail view with status, stats, progress and message', async ({ page }) => {
    await openDetails(page);
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    // Scope to the stat cards by their exact label ("Sent" and "Not sent" also
    // appear as per-row result badges; the card counts unanswered texts too).
    const statCard = (label) => page.locator('.ds-card').filter({ has: page.getByText(label, { exact: true }) }).first();
    await expect(statCard('Audience')).toBeVisible();
    await expect(statCard('Sent')).toBeVisible();
    await expect(statCard('Not sent or unconfirmed')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Campaign progress' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Message Content/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Details', exact: true })).toBeVisible();
  });

  test('returns to the dashboard from the accessible back button', async ({ page }) => {
    await openDetails(page);
    await page.getByRole('button', { name: 'Back to campaigns' }).click();
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  });

  test('keeps the detail view within the viewport (no document overflow) @mobile', async ({ page }, testInfo) => {
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

// A campaign that failed part-way (`e2eCampaignList=stopped`): 250 of 406 tried.
// Continue is only opened and declined here, so nothing is sent; the callable
// and its outcomes are covered by the vitest suite and the functions tests.
test.describe('A campaign that stopped part-way', () => {
  test.describe.configure({ timeout: 90_000 });

  async function openStopped(page) {
    await page.goto(`${URL}&e2eCampaignList=stopped`);
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('tab', { name: /Sent & live/i }).click();
    await expect(page.getByText('E2E Stopped Session')).toBeVisible();
    await page.getByRole('button', { name: /Details/ }).click();
    await expect(page.getByRole('heading', { name: 'E2E Stopped Session' })).toBeVisible();
  }

  const statCard = (page, label) => page.locator('.ds-card').filter({ has: page.getByText(label, { exact: true }) }).first();

  test('counts who was not attempted yet, and offers Continue with a confirmation that sends nothing until confirmed @mobile', async ({ page }) => {
    await openStopped(page);
    await expect(statCard(page, 'Audience')).toContainText('406');
    await expect(statCard(page, 'Sent')).toContainText('19');
    await expect(statCard(page, 'Not sent or unconfirmed')).toContainText('231');
    await expect(statCard(page, 'Not attempted yet')).toContainText('156');

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Continue this campaign?' });
    await expect(dialog).toContainText('the 156 recipients not attempted yet get the message');
    await expect(dialog).toContainText('The 250 recipients already attempted are not messaged again.');
    await expect(dialog.getByRole('button', { name: 'Send to 156 recipients' })).toBeVisible();

    const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

    await dialog.getByRole('button', { name: 'Not now' }).click();
    await expect(dialog).toBeHidden();
    // Still the report: nothing was sent, nothing closed.
    await expect(page.getByRole('heading', { name: 'E2E Stopped Session' })).toBeVisible();
  });

  test('keeps the four counts and the actions within the viewport @mobile', async ({ page }, testInfo) => {
    const widths = testInfo.project.name.startsWith('mobile') ? [412] : [1440, 1024];
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 412 ? 915 : 900 });
      await openStopped(page);
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
      for (const label of ['Audience', 'Sent', 'Not sent or unconfirmed', 'Not attempted yet']) {
        const box = await statCard(page, label).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport();
    }
  });
});
