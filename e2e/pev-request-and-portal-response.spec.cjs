const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function gotoMockPortal(page) {
  await page.goto('/verify/e2e-token-1?e2eVerify=mock');
  await expect(page.getByRole('heading', { name: /Previous Employment Verification/i })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('PEV portal response UX', () => {
  test.describe.configure({ timeout: 60_000 });

  test('public employer can complete verification response in E2E mock mode', async ({ page }) => {
    await gotoMockPortal(page);
    await expect(page.getByText(/E2E Driver/i)).toBeVisible();

    await page.getByRole('button', { name: /Submit Verification Response/i }).click();
    await expect(page.getByText(/Please fix the following errors/i)).toBeVisible();

    await page.getByText('No / No Record Found').click();
    await page.getByPlaceholder('e.g., John Smith').fill('Alex Employer');
    await page.getByPlaceholder('e.g., Safety Director, HR Manager').fill('HR Director');
    await page.getByPlaceholder('(555) 123-4567').fill('555-111-2222');
    await page.getByRole('button', { name: /Use Test Signature/i }).click();

    await page.getByRole('button', { name: /Submit Verification Response/i }).click();
    await expect(page.getByText(/Verification Submitted Successfully/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/A PDF record has been generated/i)).toBeVisible();
  });

  test('keeps a grouped, keyboard-focusable employment question with visible focus (desktop)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoMockPortal(page);

    const group = page.getByRole('group', { name: /Was this individual employed by your company\?/i });
    await expect(group).toBeVisible();
    const yes = group.getByRole('radio', { name: 'Yes' });
    await yes.focus();
    await expect(yes).toBeFocused();

    const focusPresentation = await group.locator('label', { hasText: 'Yes' }).first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focusPresentation.boxShadow !== 'none' || focusPresentation.outline !== 'none').toBe(true);
  });

  test('keeps the form within the viewport on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoMockPortal(page);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a single-column mobile layout without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await gotoMockPortal(page);
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious or critical accessibility violations on the loaded form', async ({ page }) => {
    await gotoMockPortal(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
