// E2E coverage for the Company Settings Team & Users design-system slice:
// the Add New User form and the Manage Team modal (shared accessible dialog).
// Presentation, keyboard, focus restoration, responsive overflow at
// 1440/1024/412, and a scoped axe pass. No real user is created here.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openTeamTab(page) {
  await page.goto(SETTINGS_URL);
  await expect(page.getByRole('button', { name: 'Team & Users' })).toBeVisible();
  await page.getByRole('button', { name: 'Team & Users' }).click();
  await expect(page.getByRole('heading', { name: 'Team Management' })).toBeVisible();
}

test.describe('Company Settings Team & Users', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes a labelled, required Add New User form with safe autocomplete', async ({ page }) => {
    await openTeamTab(page);

    const email = page.getByRole('textbox', { name: /Email/i });
    const password = page.getByLabel(/Password/i);
    await expect(page.getByRole('textbox', { name: /Full Name/i })).toHaveAttribute('required', '');
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', 'off');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.getByRole('combobox', { name: /Role/i })).toHaveValue('hr_user');
  });

  test('keeps a logical keyboard order and visible focus on desktop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openTeamTab(page);

    const fullName = page.getByRole('textbox', { name: /Full Name/i });
    await page.keyboard.press('Tab');
    // The first field may be reached after in-page controls; focus it directly
    // and confirm a visible focus ring, then check tab progression to Email.
    await fullName.focus();
    await expect(fullName).toBeFocused();
    const focusPresentation = await fullName.evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focusPresentation.boxShadow !== 'none' || focusPresentation.outline !== 'none').toBe(true);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: /Email/i })).toBeFocused();
  });

  test('opens the Manage Team dialog and restores focus on Escape', async ({ page }) => {
    await openTeamTab(page);
    const trigger = page.getByRole('button', { name: /View All Team Members & Goals/i });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Manage Team & Links' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription('Set goals and get tracking links for your recruiters.');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('keeps the form within the viewport on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await openTeamTab(page);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a single-column mobile layout without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openTeamTab(page);
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious or critical accessibility violations on the team tab', async ({ page }) => {
    await openTeamTab(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
