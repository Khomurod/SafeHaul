const { test, expect } = require('@playwright/test');
const { fillStep1, fillStep2 } = require('./helpers/wizardHelpers.cjs');

test.describe('guest draft resume', () => {
  test.describe.configure({ timeout: 60_000 });

  test('reload restores draft data and advances to saved step', async ({ page }) => {
    await page.goto('/apply/e2e-company');
    await fillStep1(page, 'draft');
    await fillStep2(page);

    const draftKey = 'draft_e2e-company';
    await expect
      .poll(async () => page.evaluate((key) => localStorage.getItem(key), draftKey))
      .not.toBeNull();

    const parsed = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), draftKey);
    expect(parsed.firstName).toBe('Testdraft');
    expect(parsed.lastStep).toBeGreaterThanOrEqual(2);

    await page.reload();
    await expect(page.locator('#step-title')).toContainText('License', { timeout: 30_000 });
  });
});
