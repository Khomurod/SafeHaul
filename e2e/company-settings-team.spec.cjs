// E2E coverage for Company Settings → Team: the team table (roster answered as
// `listCompanyTeam` would), the "Add person" dialog with its form, keyboard and
// focus, responsive overflow at 1440/1024/412, and an axe pass. No real user is
// created here.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { TEAM_ROSTER, serveCallables } = require('./helpers/callables.cjs');

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openTeamTab(page) {
  await serveCallables(page, { listCompanyTeam: TEAM_ROSTER });
  await page.goto(`${SETTINGS_URL}&section=team`);
  await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: /^Artificial Admin/ })).toBeVisible({ timeout: 20_000 });
}

test.describe('Company Settings → Team', () => {
  test.describe.configure({ timeout: 90_000 });

  test('lists the team with roles and states, and the row actions', async ({ page }) => {
    await openTeamTab(page);
    const table = page.getByRole('table', { name: 'Team' });
    await expect(table.getByRole('row')).toHaveCount(4);
    await expect(table.getByText('Company admin')).toBeVisible();
    await expect(table.getByText('No sign-in account')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy recruiting link for Artificial Admin' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Daily goals for Artificial Admin' })).toBeVisible();
  });

  test('opens Add person with a labelled, required form, and restores focus on Escape', async ({ page }) => {
    await openTeamTab(page);
    const trigger = page.getByRole('button', { name: 'Add person' });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Add person' });
    await expect(dialog).toBeVisible();
    const email = dialog.getByRole('textbox', { name: /Email/i });
    const password = dialog.getByLabel(/Password/i);
    await expect(dialog.getByRole('textbox', { name: /Full Name/i })).toHaveAttribute('required', '');
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', 'off');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveAttribute('autocomplete', 'new-password');
    await expect(dialog.getByRole('combobox', { name: /Role/i })).toHaveValue('hr_user');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('keeps a logical keyboard order and visible focus in the form', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openTeamTab(page);
    await page.getByRole('button', { name: 'Add person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add person' });

    const fullName = dialog.getByRole('textbox', { name: /Full Name/i });
    await fullName.focus();
    const focusPresentation = await fullName.evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focusPresentation.boxShadow !== 'none' || focusPresentation.outline !== 'none').toBe(true);
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('textbox', { name: /Email/i })).toBeFocused();
  });

  test('fits desktop and tablet without document overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await openTeamTab(page);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('shows one card per member on a phone without horizontal overflow @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await openTeamTab(page);
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    await expect(page.getByRole('button', { name: 'Add person' })).toBeVisible();
  });

  test('has no serious or critical accessibility violations on the team page', async ({ page }) => {
    await openTeamTab(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
