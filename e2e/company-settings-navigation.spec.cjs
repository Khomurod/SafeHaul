const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openSettings(page) {
  await page.goto(SETTINGS_URL);
  await expect(
    page.getByRole('navigation', { name: 'Company settings sections' }),
  ).toBeVisible();
}

test.describe('Company Settings shell and navigation compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes current-item semantics and keeps keyboard focus during tab switching', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSettings(page);

    const company = page.getByRole('button', { name: 'Company Profile' });
    const team = page.getByRole('button', { name: 'Team & Users' });

    await expect(company).toHaveAttribute('aria-current', 'page');
    await expect(company).toHaveAttribute('aria-controls', 'company-settings-content');

    await company.focus();
    await page.keyboard.press('ArrowDown');
    await expect(team).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(team).toBeFocused();
    await expect(team).toHaveAttribute('aria-current', 'page');
    await expect(company).not.toHaveAttribute('aria-current');
  });

  test('keeps tablet navigation and content aligned without nested overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Tablet geometry check.');
    await page.setViewportSize({ width: 1024, height: 768 });
    await openSettings(page);

    const geometry = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="company-settings-shell"]');
      const navigation = document.querySelector('.ds-section-navigation');
      const content = document.querySelector('#company-settings-content');
      const workspace = document.querySelector('.ds-workspace__main');
      const heading = navigation?.querySelector('.ds-section-navigation__heading');
      const item = navigation?.querySelector('.ds-section-navigation__item');
      const navBox = navigation?.getBoundingClientRect();
      const contentBox = content?.getBoundingClientRect();
      const nestedHorizontalScrollers = [...(content?.querySelectorAll('*') || [])]
        .filter((element) => {
          const overflowX = getComputedStyle(element).overflowX;
          return ['auto', 'scroll'].includes(overflowX)
            && element.scrollWidth > element.clientWidth + 1;
        });
      const groupColumns = new Set(
        [...(navigation?.querySelectorAll('.ds-section-navigation__group') || [])]
          .map((group) => Math.round(group.getBoundingClientRect().x)),
      ).size;

      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        shellClientWidth: shell?.clientWidth,
        shellScrollWidth: shell?.scrollWidth,
        workspaceClientWidth: workspace?.clientWidth,
        workspaceScrollWidth: workspace?.scrollWidth,
        navRight: navBox?.right,
        contentLeft: contentBox?.left,
        navBottom: navBox?.bottom,
        contentTop: contentBox?.top,
        headingFontSize: Number.parseFloat(getComputedStyle(heading).fontSize),
        itemHeight: item?.getBoundingClientRect().height,
        nestedHorizontalScrollerCount: nestedHorizontalScrollers.length,
        groupColumns,
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.shellScrollWidth).toBeLessThanOrEqual(geometry.shellClientWidth);
    expect(geometry.workspaceScrollWidth).toBeLessThanOrEqual(geometry.workspaceClientWidth);
    expect(geometry.contentTop).toBeGreaterThan(geometry.navBottom);
    expect(geometry.contentLeft).toBeLessThan(geometry.navRight);
    expect(geometry.groupColumns).toBe(4);
    expect(geometry.nestedHorizontalScrollerCount).toBe(0);
    expect(geometry.headingFontSize).toBeGreaterThanOrEqual(12);
    expect(geometry.itemHeight).toBeGreaterThanOrEqual(44);
  });

  test('keeps every section reachable in a mobile grid without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openSettings(page);

    const navigation = page.getByRole('navigation', { name: 'Company settings sections' });
    const expectedItems = [
      'Company Profile',
      'Team & Users',
      'Email Settings',
      'SMS Settings',
      'Automated SMS',
      'Integrations',
      'Billing & Plan',
      'Security Profile',
    ];

    for (const label of expectedItems) {
      await expect(page.getByRole('button', { name: label })).toBeAttached();
    }

    const geometry = await navigation.evaluate((element) => {
      const groupBoxes = [...element.querySelectorAll('.ds-section-navigation__group')]
        .map((group) => group.getBoundingClientRect());
      const itemBoxes = [...element.querySelectorAll('.ds-section-navigation__item')]
        .map((item) => item.getBoundingClientRect());
      const shell = document.querySelector('[data-testid="company-settings-shell"]');
      const nestedHorizontalScrollers = [...(shell?.querySelectorAll('*') || [])]
        .filter((candidate) => {
          const overflowX = getComputedStyle(candidate).overflowX;
          return ['auto', 'scroll'].includes(overflowX)
            && candidate.scrollWidth > candidate.clientWidth + 1;
        });

      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        navigationWidth: element.getBoundingClientRect().width,
        distinctGroupColumns: new Set(groupBoxes.map((box) => Math.round(box.x))).size,
        minimumItemHeight: Math.min(...itemBoxes.map((box) => box.height)),
        itemRightEdge: Math.max(...itemBoxes.map((box) => box.right)),
        nestedHorizontalScrollerCount: nestedHorizontalScrollers.length,
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.navigationWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.distinctGroupColumns).toBe(2);
    expect(geometry.minimumItemHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.itemRightEdge).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.nestedHorizontalScrollerCount).toBe(0);

    const security = page.getByRole('button', { name: 'Security Profile' });
    await security.scrollIntoViewIfNeeded();
    await security.click();
    await expect(security).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Personal Profile', exact: true }))
      .toBeVisible();
  });

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await openSettings(page);

    const { violations } = await new AxeBuilder({ page })
      .include('[data-testid="company-settings-shell"]')
      .analyze();
    const severe = violations
      .filter((violation) => ['serious', 'critical'].includes(violation.impact))
      .flatMap((violation) => violation.nodes.map((node) => (
        `${violation.id} [${violation.impact}] ${node.target.join(' ')}: ${node.failureSummary}`
      )));

    expect(severe).toEqual([]);
  });
});
