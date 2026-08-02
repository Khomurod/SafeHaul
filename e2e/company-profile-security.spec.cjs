// E2E coverage for the Company account profile & security design-system slice
// (/company/profile → UserProfilePage). Verifies the accessible avatar-upload
// contract, keyboard focus, no nested interactive elements, sensitive-field
// autocomplete, responsive overflow at 1440/1024/412, and a scoped axe pass.
// The real avatar upload and Auth reauthentication are NOT triggered here (they
// need Firebase Storage/Auth); their exact contracts are covered by the vitest
// suite. Only artificial, non-production values are ever entered.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const PROFILE_URL = '/company/profile?e2eAuth=company_admin';

async function openProfile(page) {
  await page.goto(PROFILE_URL);
  await expect(page.getByRole('heading', { name: 'My Profile', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Profile Information' })).toBeVisible();
}

test.describe('Company account profile & security compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes a labelled image-only avatar upload trigger', async ({ page }) => {
    await openProfile(page);

    const input = page.locator('input[type="file"]');
    await expect(input).toHaveAttribute('accept', 'image/*');
    await expect(input).toHaveAttribute('aria-label', 'Upload profile photo');
    await expect(page.getByText(/Accepts image files under 2 MB/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /change photo|upload photo/i })).toBeVisible();
  });

  test('keeps the avatar trigger keyboard-focusable with visible focus and no nesting', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openProfile(page);

    const trigger = page.getByRole('button', { name: /change photo|upload photo/i });
    await trigger.focus();
    await expect(trigger).toBeFocused();

    const focusPresentation = await trigger.evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focusPresentation.boxShadow !== 'none' || focusPresentation.outline !== 'none').toBe(true);

    const nesting = await page.evaluate(() => {
      const input = document.querySelector('input[type="file"]');
      return {
        insideButton: !!input.closest('button'),
        insideLabel: !!input.closest('label'),
      };
    });
    expect(nesting.insideButton).toBe(false);
    expect(nesting.insideLabel).toBe(false);
  });

  test('applies correct autocomplete to the password fields', async ({ page }) => {
    await openProfile(page);

    await expect(page.getByLabel('Current Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.getByLabel('New Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.getByLabel('Confirm New Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
  });

  test('keeps content within the viewport on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await openProfile(page);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a single-column mobile layout without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openProfile(page);

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await openProfile(page);

    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
