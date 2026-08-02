// E2E coverage for the Company Profile branding-upload design-system slice.
// Verifies the accessible file-input contract, keyboard focus, no nested
// interactive elements, responsive overflow at 1440/1024/412, and a scoped axe
// pass. The real upload is not triggered here (it needs Firebase Storage); the
// exact Storage/Firestore contracts are covered by the vitest suite.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openBrandingEditing(page) {
  await page.goto(SETTINGS_URL);
  await expect(page.getByTestId('company-information')).toBeVisible();
  await page.getByRole('button', { name: 'Edit Profile' }).click();
  await expect(page.getByRole('button', { name: /change logo|upload logo/i })).toBeVisible();
}

test.describe('Company Settings branding upload compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes a labelled file input with visible accepted types', async ({ page }) => {
    await openBrandingEditing(page);

    const input = page.locator('input[type="file"]');
    await expect(input).toHaveAttribute('accept', 'image/*');
    await expect(input).toHaveAttribute('aria-label', 'Upload company logo');
    await expect(page.getByText(/Accepts image files/i)).toBeVisible();
  });

  test('keeps the upload trigger keyboard-focusable with visible focus and no nesting', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBrandingEditing(page);

    // Editing autofocuses Company Name; the upload trigger is the previous
    // focusable in the identity card.
    const companyName = page.getByRole('textbox', { name: 'Company Name' });
    await expect(companyName).toBeFocused();

    const trigger = page.getByRole('button', { name: /change logo|upload logo/i });
    await page.keyboard.press('Shift+Tab');
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

  test('keeps the branding block within the viewport on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await openBrandingEditing(page);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a single-column mobile layout without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openBrandingEditing(page);

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious or critical accessibility violations in edit mode', async ({ page }) => {
    await openBrandingEditing(page);

    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
