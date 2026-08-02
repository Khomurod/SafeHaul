// E2E coverage for the LaunchPad design-system migration. The pad is the
// CampaignEditor's Launch section, reached via Create Campaign
// (e2eCampaign=mock). The mock path short-circuits `initBulkSession`, so the
// real launch function is never invoked here. Verifies the pre-flight states,
// the accessible confirmation dialog (Escape / focus / mobile-safe actions),
// responsive overflow at 1440/1024/412, and a scoped axe pass.
// The exact payload, error mapping and duplicate-launch guards are covered by
// the vitest suite.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock';

async function openLaunch(page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Create Campaign/i }).click();
  await expect(page.getByRole('textbox', { name: 'Campaign Name' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Launch/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Ready for Liftoff?' })).toBeVisible({ timeout: 15_000 });
}

test.describe('Campaign launch pad slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('states the pre-flight result with text, not colour alone', async ({ page }) => {
    await openLaunch(page);

    // The seeded mock draft targets 12 recipients with a message, so the checks pass.
    const status = page.getByRole('status').filter({ hasText: 'All Systems Go' });
    await expect(status).toBeVisible();
    // 12 recipients * 3s = 36s -> 1 min.
    await expect(status).toContainText('Est. Duration: ~1 min');
    await expect(page.getByRole('button', { name: /Launch Immediately/ })).toBeEnabled();
  });

  test('opens an accessible confirmation dialog that Escape dismisses', async ({ page }) => {
    await openLaunch(page);

    const launch = page.getByRole('button', { name: /Launch Immediately/ });
    await launch.click();

    const dialog = page.getByRole('dialog', { name: 'Confirm campaign launch' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toContainText('E2E mock campaign message.');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Confirm Launch' })).toBeVisible();

    // Escape dismisses without launching, and focus returns to the trigger.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(launch).toBeFocused();
  });

  test('cancelling leaves the campaign unlaunched', async ({ page }) => {
    await openLaunch(page);
    await page.getByRole('button', { name: /Launch Immediately/ }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Ready for Liftoff?' })).toBeVisible();
  });

  test('does not overflow the document at desktop/tablet/mobile', async ({ page }, testInfo) => {
    const widths = testInfo.project.name.startsWith('mobile') ? [412] : [1440, 1024];
    await page.setViewportSize({ width: widths[0], height: widths[0] === 412 ? 915 : 900 });
    await openLaunch(page);

    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 412 ? 915 : 900 });
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    }
  });

  test('has no serious/critical or contrast violations in the launch pad', async ({ page }) => {
    await openLaunch(page);
    const { violations } = await new AxeBuilder({ page }).include('.max-w-2xl').analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });
});
