// E2E coverage for the CampaignEditor shell design-system migration. Opens the
// editor via Create Campaign (e2eCampaign=mock) and verifies the labelled name,
// keyboard-accessible section nav with programmatic current state, the Exit
// action, no document overflow at 1440/1024/412, and a shell-scoped axe pass.
// The lazy Audience/Content/Launch modules are separate slices, not asserted here.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock';

async function openEditor(page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Create Campaign/i }).click();
  await expect(page.getByRole('textbox', { name: 'Campaign Name' })).toBeVisible({ timeout: 15_000 });
}

test.describe('CampaignEditor shell compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('renders the labelled name, section nav and save status', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByRole('textbox', { name: 'Campaign Name' })).toHaveValue('E2E Mock Campaign');
    await expect(page.getByRole('navigation', { name: 'Campaign sections' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Audience/ })).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('aside').getByText('Auto-Saved')).toBeVisible();
  });

  test('moves the current step via keyboard-operable nav', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);

    const content = page.getByRole('button', { name: /Content/ });
    await content.focus();
    await expect(content).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(content).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('button', { name: /Audience/ })).not.toHaveAttribute('aria-current', 'step');
  });

  test('exits back to the dashboard', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Exit' }).click();
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  });

  test('does not overflow the document at desktop/tablet/mobile', async ({ page }, testInfo) => {
    const widths = testInfo.project.name.startsWith('mobile') ? [412] : [1440, 1024];
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 412 ? 915 : 900 });
      await openEditor(page);
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    }
  });

  test('has no serious or critical accessibility violations in the editor shell', async ({ page }) => {
    await openEditor(page);
    // Scope to the migrated shell (sidebar/nav/name/save); the lazy content
    // modules are separate slices.
    const { violations } = await new AxeBuilder({ page }).include('aside').analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
