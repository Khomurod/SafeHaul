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

  test('every forward step is also saved server-side, with the step it reached', async ({ page }) => {
    await page.goto('/apply/e2e-company');
    await fillStep1(page, 'draft');
    await fillStep2(page);

    // Per-step drafting used to be gated behind the E2E flag, so in production
    // nothing was written per step at all — this spec proved a mechanism that was
    // only ever switched on for itself.
    const saves = await page.evaluate(() => window.__e2eDraftSaves || []);
    expect(saves.length).toBeGreaterThanOrEqual(2);

    // The semantic id, not just the index, so a company whose custom-questions
    // step is present lands a resumed applicant on the page they were on.
    expect(saves.map((save) => save.lastSemanticStep)).toContain('license');
    expect(saves[saves.length - 1].formData.firstName).toBe('Testdraft');
  });
});
