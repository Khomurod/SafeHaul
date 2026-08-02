// E2E coverage for the Login/Auth design-system slice. Verifies keyboard order,
// focus visibility, autofill attributes, the accessible reset dialog, responsive
// layout/overflow at 1440/1024/412, and a scoped axe pass. Authentication and
// redirects are covered by the vitest suite (they need a mocked Firebase
// backend); this spec asserts presentation, accessibility, and responsiveness.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function gotoLogin(page) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
}

test.describe('Login/Auth compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes labelled fields with preserved autofill attributes', async ({ page }) => {
    await gotoLogin(page);

    const email = page.getByRole('textbox', { name: /email address/i });
    const password = page.getByPlaceholder('Enter your password');

    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', 'email');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
  });

  test('keeps a logical keyboard order and visible focus on desktop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoLogin(page);

    const email = page.getByRole('textbox', { name: /email address/i });
    const password = page.getByPlaceholder('Enter your password');
    const toggle = page.getByRole('button', { name: /show password/i });
    const forgot = page.getByRole('button', { name: /forgot password/i });
    const signIn = page.getByRole('button', { name: /sign in/i });

    await page.keyboard.press('Tab');
    await expect(email).toBeFocused();

    const focusPresentation = await email.evaluate((element) => {
      const styles = getComputedStyle(element);
      return { boxShadow: styles.boxShadow, outline: styles.outlineStyle };
    });
    expect(
      focusPresentation.boxShadow !== 'none' || focusPresentation.outline !== 'none',
    ).toBe(true);

    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(forgot).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(signIn).toBeFocused();

    // Label and control share a left edge (FormField association).
    const [labelBox, controlBox] = await Promise.all([
      page.locator('label[for="email"]').boundingBox(),
      email.boundingBox(),
    ]);
    expect(labelBox).not.toBeNull();
    expect(controlBox).not.toBeNull();
    expect(Math.abs(labelBox.x - controlBox.x)).toBeLessThan(1);
  });

  test('reveals and hides the password from a labelled control', async ({ page }) => {
    await gotoLogin(page);
    const password = page.getByPlaceholder('Enter your password');

    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: /show password/i }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: /hide password/i }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  test('opens the reset dialog with initial focus and closes on Escape', async ({ page }) => {
    await gotoLogin(page);
    await page.getByRole('textbox', { name: /email address/i }).fill('recruiter@example.com');
    await page.getByRole('button', { name: /forgot password/i }).click();

    const dialog = page.getByRole('dialog', { name: 'Reset your password' });
    await expect(dialog).toBeVisible();

    const resetEmail = dialog.getByRole('textbox', { name: /email address/i });
    await expect(resetEmail).toBeFocused();
    await expect(resetEmail).toHaveValue('recruiter@example.com');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Focus returns to the trigger (shared Modal focus restoration).
    await expect(page.getByRole('button', { name: /forgot password/i })).toBeFocused();
  });

  test('shows the marketing panel and no overflow on desktop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop presentation check.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoLogin(page);

    await expect(page.getByRole('heading', { name: 'Your Gateway to the Road' })).toBeVisible();

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('keeps the tablet layout free of horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Tablet geometry check.');
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoLogin(page);

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('uses a single-column mobile layout without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await gotoLogin(page);

    // Marketing panel is hidden below the lg breakpoint.
    await expect(page.getByRole('heading', { name: 'Your Gateway to the Road' })).toBeHidden();

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await gotoLogin(page);

    const scan = async () => {
      const { violations } = await new AxeBuilder({ page }).analyze();
      return violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    };

    expect(await scan()).toEqual([]);

    // Reset dialog open.
    await page.getByRole('button', { name: /forgot password/i }).click();
    await expect(page.getByRole('dialog', { name: 'Reset your password' })).toBeVisible();
    expect(await scan()).toEqual([]);
  });
});
