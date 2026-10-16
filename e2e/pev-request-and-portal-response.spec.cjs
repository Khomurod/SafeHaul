const { test, expect } = require('@playwright/test');

// The submitted response, the overflow at desktop and tablet widths and axe on
// the loaded form are in `verification-portal-closeout.spec.cjs`; the success
// screen's wording is asserted in `VerificationPortal.test.jsx`.

async function gotoMockPortal(page) {
  await page.goto('/verify/e2e-token-1?e2eVerify=mock');
  await expect(page.getByRole('heading', { name: /Previous Employment Verification/i })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('PEV portal response UX', () => {
  test.describe.configure({ timeout: 60_000 });

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

  test('uses a single-column mobile layout without horizontal overflow @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await gotoMockPortal(page);
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });
});
