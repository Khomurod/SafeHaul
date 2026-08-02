const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const DASHBOARD_URL = '/company/dashboard?e2eAuth=company_admin';

async function openDashboard(page) {
  await page.goto(DASHBOARD_URL);
  await expect(page.getByRole('heading', { name: 'Welcome back, Admin User' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Team leaderboard' })).toBeVisible();
}

test.describe('Company workspace shell and dashboard', () => {
  test.describe.configure({ timeout: 90_000 });

  test('preserves dashboard actions, routes, table alignment, and desktop collapse', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop and laptop shell behavior.');
    await openDashboard(page);

    const applicationsMetric = page.getByRole('button', { name: 'Applications: 8' });
    await applicationsMetric.focus();
    await applicationsMetric.press('Enter');
    await expect(page).toHaveURL(/\/company\/drivers\/applications/);

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/company\/dashboard/);

    const dialsHeader = page.getByRole('columnheader', { name: 'Dials' });
    const jordanRow = page.getByRole('rowheader', { name: /Jordan Recruiter/i });
    const dialsCell = jordanRow.locator('xpath=ancestor::tr').getByRole('cell', { name: '18' });
    await expect(dialsHeader).toHaveAttribute('data-align', 'end');
    await expect(dialsCell).toHaveAttribute('data-align', 'end');

    const [headerBox, cellBox] = await Promise.all([
      dialsHeader.boundingBox(),
      dialsCell.boundingBox(),
    ]);
    expect(Math.abs(
      (headerBox.x + headerBox.width) - (cellBox.x + cellBox.width),
    )).toBeLessThan(1);

    const navigation = page.getByLabel('Company navigation');
    const expandedWidth = await navigation.evaluate((element) => element.getBoundingClientRect().width);
    expect(expandedWidth).toBeGreaterThanOrEqual(255);

    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeVisible();
    await expect.poll(
      () => navigation.evaluate((element) => element.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(65);

    expect(await page.evaluate(() => localStorage.getItem('companySidebarMode')))
      .toBe('minimized');

    await page.getByRole('link', { name: 'Import Leads' }).click();
    await expect(page.getByRole('heading', { name: 'Import Leads' })).toBeVisible();
  });

  test('keeps laptop content usable without document-level horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Laptop viewport check.');
    await page.setViewportSize({ width: 1024, height: 768 });
    await openDashboard(page);

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainWidth: document.querySelector('.ds-workspace__main')?.getBoundingClientRect().width,
      metricWidths: [...document.querySelectorAll('.ds-metric-card')]
        .map((element) => element.getBoundingClientRect().width),
    }));

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.mainWidth).toBeGreaterThan(700);
    expect(Math.min(...geometry.metricWidths)).toBeGreaterThan(210);
  });

  test('uses an off-canvas mobile navigation with Escape, focus return, and route close', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile shell behavior.');
    await openDashboard(page);

    const menuButton = page.getByRole('button', { name: 'Open navigation' });
    const navigation = page.locator('#workspace-navigation');
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(navigation).toHaveAttribute('data-open', 'false');

    const initialGeometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainWidth: document.querySelector('.ds-workspace__main')?.getBoundingClientRect().width,
    }));
    expect(initialGeometry.documentWidth).toBeLessThanOrEqual(initialGeometry.viewport);
    expect(initialGeometry.mainWidth).toBeGreaterThanOrEqual(initialGeometry.viewport - 1);

    await menuButton.click();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(navigation).toHaveAttribute('data-open', 'true');
    await expect(navigation.getByRole('button', { name: 'Close navigation' })).toBeVisible();
    expect(await navigation.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(navigation).toHaveAttribute('data-open', 'false');
    await expect(menuButton).toBeFocused();

    await menuButton.click();
    await navigation.getByRole('link', { name: 'Applications' }).click();
    await expect(page).toHaveURL(/\/company\/drivers\/applications/);
    await expect(navigation).toHaveAttribute('data-open', 'false');
  });

  test('has no serious or critical accessibility violations in the migrated surface', async ({ page }) => {
    await openDashboard(page);

    const { violations } = await new AxeBuilder({ page })
      .include('.ds-workspace')
      .analyze();
    const severe = violations
      .filter((violation) => ['serious', 'critical'].includes(violation.impact))
      .map((violation) => `${violation.id} [${violation.impact}]`);

    expect(severe).toEqual([]);
  });
});
