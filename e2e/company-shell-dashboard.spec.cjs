const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const DASHBOARD_URL = '/company/dashboard?e2eAuth=company_admin';

async function openDashboard(page) {
  await page.goto(DASHBOARD_URL);
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hired: 2' })).toBeVisible();
}

test.describe('Company workspace shell and dashboard', () => {
  test.describe.configure({ timeout: 90_000 });

  test('preserves dashboard actions, routes and desktop collapse, with no team leaderboard', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop and laptop shell behavior.');
    await openDashboard(page);

    const applicationsMetric = page.getByRole('button', { name: 'Applications: 8' });
    await applicationsMetric.focus();
    await applicationsMetric.press('Enter');
    await expect(page).toHaveURL(/\/company\/drivers\/applications/);

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/company\/dashboard/);
    await expect(page.getByRole('button', { name: 'Hired: 2' })).toBeVisible();
    // Nothing on the page is "today" any more, so the heading does not say it.
    await expect(page.getByText(/^Here's what's happening at .+\.$/)).toBeVisible();
    await expect(page.getByText(/^Here's what's happening at .* today\.$/)).toHaveCount(0);
    // The team leaderboard is gone; the call statistics stay for Super Admin → Analytics.
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText(/leaderboard/i)).toHaveCount(0);

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

    // A collapsed menu still leads somewhere. Import Leads is no longer a menu
    // item (the Leads page's header offers it: `lead-intake.spec.cjs`).
    const companyMenu = page.getByRole('navigation', { name: 'Company sections' });
    await expect(companyMenu.getByRole('link', { name: 'Import Leads' })).toHaveCount(0);
    await expect(companyMenu.getByRole('link', { name: /quick add/i })).toHaveCount(0);
    await companyMenu.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/company\/settings/);
    await expect(page.getByRole('heading', { level: 1, name: /^(Company profile|Settings)$/ })).toBeVisible();
  });

  test('opens the Hired applications from the Hired card', async ({ page }) => {
    await openDashboard(page);

    await page.getByRole('button', { name: 'Hired: 2' }).click();

    await expect(page).toHaveURL(/\/company\/drivers\/applications/);
    await expect(page.getByRole('button', { name: 'Hired', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Hired: 'Hired' + legacy 'Approved', as the segment counts them.
    await expect(page.getByText('Aisha Robinson')).toBeVisible();
    await expect(page.getByText('Derek Nguyen')).toBeVisible();
    await expect(page.getByText('2 applications', { exact: true })).toBeVisible();
  });

  // The brief counts the fixture applications (src/features/companies/hooks/e2eDashboardFixtures.js)
  // on a frozen clock: Aisha Robinson's hire is the one recorded after hire dates began (Nov 6).
  test('the hiring brief opens the In process tab and the month\'s hires it counts @mobile', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-20T18:00:00Z'));
    await openDashboard(page);

    const brief = page.getByRole('region', { name: 'This month' });
    await expect(brief).toContainText('This month: 0 applications · 1 in process · 1 hired since Nov 6');
    // One line at 1440, wrapping on a phone, never wider than the page.
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);

    await brief.getByRole('link', { name: '1 in process' }).click();
    await expect(page).toHaveURL(/\/company\/drivers\/applications/);
    await expect(page.getByRole('button', { name: 'In process', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Henry Inprocess')).toBeVisible();
    await expect(page.getByText('1 application', { exact: true })).toBeVisible();

    await openDashboard(page);
    await page.getByRole('region', { name: 'This month' }).getByRole('link', { name: '1 hired since Nov 6' }).click();
    await expect(page.getByText('Showing applications hired since Nov 6, 2026, whatever their status now.')).toBeVisible();
    await expect(page.getByText('Aisha Robinson')).toBeVisible();
    // Derek Nguyen is hired too, from before hire dates were recorded.
    await expect(page.getByText('Derek Nguyen')).toHaveCount(0);
    await expect(page.getByText('1 application', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Show all applications' }).click();
    await expect(page.getByText('8 applications', { exact: true })).toBeVisible();
  });

  test("the hiring brief opens the month's applications it counts, at 1440", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop width check; the phone runs the test above.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(new Date('2026-07-15T18:00:00Z'));
    await openDashboard(page);

    const brief = page.getByRole('region', { name: 'This month' });
    await expect(brief).toContainText('This month: 3 applications · 1 in process · 0 hired since Nov 6');
    const links = await brief.getByRole('link').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
    expect(new Set(links).size).toBe(1);

    await brief.getByRole('link', { name: '3 applications' }).click();
    await expect(page.getByText('Showing applications added in July 2026.')).toBeVisible();
    for (const name of ['Maria Garcia', 'James McDonald', 'Henry Inprocess']) {
      await expect(page.getByText(name)).toBeVisible();
    }
    await expect(page.getByText('Aisha Robinson')).toHaveCount(0);
    await expect(page.getByText('3 applications', { exact: true })).toBeVisible();
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

  test('uses an off-canvas mobile navigation with Escape, focus return, and route close @mobile', async ({ page }, testInfo) => {
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
    // `exact`: "Unfinished applications" sits in the same section.
    await navigation.getByRole('link', { name: 'Applications', exact: true }).click();
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
