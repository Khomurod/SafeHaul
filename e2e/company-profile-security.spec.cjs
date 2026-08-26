// E2E coverage for the Company account profile & security design-system slice
// (/company/profile → UserProfilePage). Verifies the accessible avatar-upload
// contract, keyboard focus, no nested interactive elements, sensitive-field
// autocomplete, responsive overflow at 1440/1024/412, and a scoped axe pass.
// The real avatar upload and Auth reauthentication are NOT triggered here (they
// need Firebase Storage/Auth); their exact contracts are covered by the vitest
// suite. Only artificial, non-production values are ever entered.
//
// The avatar assertions were rewritten on 2026-08-25 for the approved
// `FileInput`. The control used to be a `Button` driving a hidden input, so they
// looked for a *button* and asserted the input was NOT inside a label. The
// picker contract is the opposite by design: a real focusable input inside a
// `<label>` styled as the visible control, with the accessible name on the field.
// Same intent, the contract's shape. See `design-system/components/file-input`.
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

    const input = page.getByRole('button', { name: 'Profile photo', exact: true });
    await expect(input).toHaveAttribute('accept', 'image/*');
    await expect(input).toHaveAttribute('type', 'file');
    // Announced as the field, not as the trigger — "Profile photo", not
    // "Upload photo". The trigger's words stay visible on the label.
    await expect(input).toHaveAccessibleName('Profile photo');
    await expect(page.getByText(/Accepts image files under 2 MB/i)).toBeVisible();
    await expect(page.getByText(/change photo|upload photo/i)).toBeVisible();
    // The size limit is the input's description, so it is heard before the
    // picker opens rather than discovered from a rejection afterwards.
    const describedBy = await input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy.split(' ').pop()}`)).toContainText(/under 2 MB/i);
  });

  test('keeps the avatar trigger keyboard-focusable with visible focus and no nesting', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openProfile(page);

    const input = page.getByRole('button', { name: 'Profile photo', exact: true });
    await input.focus();
    await expect(input).toBeFocused();

    /*
     * The ring is drawn on the label through `:focus-within`, because the input
     * itself is clipped to 1x1 and an outline on it would be invisible. The label
     * is also the pointer target, so it is the thing that must be big enough.
     */
    const focusPresentation = await input.evaluate((el) => {
      const label = el.closest('label');
      const s = getComputedStyle(label);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle, target: label.getBoundingClientRect().height };
    });
    expect(focusPresentation.boxShadow !== 'none' || focusPresentation.outline !== 'none').toBe(true);
    expect(focusPresentation.target).toBeGreaterThanOrEqual(24);

    const nesting = await page.evaluate(() => {
      const input = document.querySelector('input[type="file"]');
      const label = input.closest('label');
      return {
        // Still forbidden: an input inside a button is the shape that broke the
        // keyboard path in the controls this replaced.
        insideButton: !!input.closest('button'),
        // Its own label is the contract; a second interactive element sharing
        // that label is not.
        insideLabel: !!label,
        otherInteractiveInLabel: label
          ? label.querySelectorAll('button, a[href], select, textarea, input:not([type=file])').length
          : 0,
      };
    });
    expect(nesting.insideButton).toBe(false);
    expect(nesting.insideLabel).toBe(true);
    expect(nesting.otherInteractiveInLabel).toBe(0);
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
