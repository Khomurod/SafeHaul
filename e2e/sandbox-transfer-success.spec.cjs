// E2E coverage for the Sandbox Transfer Success status screen design-system
// slice. The route is public and reads optional navigate state; visiting it
// directly exercises the final company-name fallback. Verifies heading,
// status, keyboard-operable actions with visible focus, responsive overflow at
// 1440/1024/412, and a scoped axe pass.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function gotoScreen(page) {
  await page.goto('/sandbox/transfer-success');
  await expect(page.getByRole('heading', { level: 1, name: 'Transfer complete' })).toBeVisible();
}

test.describe('Sandbox Transfer Success status slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('shows the heading, status, and both actions', async ({ page }) => {
    await gotoScreen(page);
    await expect(page.getByText('New Application')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Super Admin' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
  });

  test('keeps both actions keyboard-operable with visible focus (desktop)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoScreen(page);

    const superAdmin = page.getByRole('button', { name: 'Super Admin' });
    const home = page.getByRole('button', { name: 'Home' });

    await page.keyboard.press('Tab');
    await expect(superAdmin).toBeFocused();

    const focusPresentation = await superAdmin.evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focusPresentation.boxShadow !== 'none' || focusPresentation.outline !== 'none').toBe(true);

    await page.keyboard.press('Tab');
    await expect(home).toBeFocused();
  });

  test('has no document overflow on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoScreen(page);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a single-column mobile layout without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await gotoScreen(page);
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await gotoScreen(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
