const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openBilling(page) {
  await page.goto(SETTINGS_URL);
  await page.getByRole('button', { name: 'Billing & Plan' }).click();
  await expect(page.getByTestId('billing-settings')).toBeVisible();
}

test.describe('Company Settings Billing informational card compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('shows the labelled plan, subtitle, and support guidance on desktop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop presentation check.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBilling(page);

    const region = page.getByRole('region', { name: 'Billing & Plan' });
    await expect(region.getByRole('heading', { level: 2, name: 'Billing & Plan' })).toBeVisible();
    await expect(region.getByText('Manage your subscription.')).toBeVisible();
    await expect(region.getByText('Current Plan')).toBeVisible();
    // The E2E company fixture carries no paid plan, so it resolves to Free Plan.
    await expect(region.getByText('Free Plan')).toBeVisible();
    await expect(region.getByText('To upgrade or cancel, please contact support.')).toBeVisible();

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewportWidth);
  });

  test('keeps tablet layout free of document or nested horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Tablet geometry check.');
    await page.setViewportSize({ width: 1024, height: 768 });
    await openBilling(page);

    const geometry = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="company-settings-shell"]');
      const content = document.querySelector('#company-settings-content');
      const nestedHorizontalScrollers = [...(shell?.querySelectorAll('*') || [])]
        .filter((element) => {
          const overflowX = getComputedStyle(element).overflowX;
          return ['auto', 'scroll'].includes(overflowX)
            && element.scrollWidth > element.clientWidth + 1;
        });

      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        contentClientWidth: content?.clientWidth,
        contentScrollWidth: content?.scrollWidth,
        nestedHorizontalScrollerCount: nestedHorizontalScrollers.length,
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.contentScrollWidth).toBeLessThanOrEqual(geometry.contentClientWidth);
    expect(geometry.nestedHorizontalScrollerCount).toBe(0);
  });

  test('fits within a mobile viewport with the plan and guidance visible', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openBilling(page);

    const card = page.getByTestId('billing-settings');
    await expect(card.getByText('Free Plan')).toBeVisible();
    await expect(card.getByText('To upgrade or cancel, please contact support.')).toBeVisible();

    const geometry = await page.evaluate(() => {
      const section = document.querySelector('[data-testid="billing-settings"]');
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        sectionRight: section.getBoundingClientRect().right,
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.sectionRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  });

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await openBilling(page);

    const { violations } = await new AxeBuilder({ page })
      .include('#company-settings-content')
      .analyze();
    const severe = violations
      .filter((violation) => ['serious', 'critical'].includes(violation.impact))
      .flatMap((violation) => violation.nodes.map((node) => (
        `${violation.id} [${violation.impact}] ${node.target.join(' ')}: ${node.failureSummary}`
      )));

    expect(severe).toEqual([]);
  });
});
