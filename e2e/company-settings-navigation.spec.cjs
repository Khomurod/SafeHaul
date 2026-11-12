const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

/**
 * The way back to the menu above a section. Scoped to the settings content:
 * from 768px the company's own menu beside the page has a Settings link too.
 */
function backToSettings(page) {
  return page.getByRole('region', { name: 'Company settings content' }).getByRole('link', { name: 'Settings', exact: true });
}

async function openSettings(page) {
  await page.goto(SETTINGS_URL);
  // From 1181px up Company profile opens beside the rail; a phone or a tablet
  // opens its menu of sections instead.
  await expect(page.getByRole('heading', { level: 1, name: /^(Company profile|Settings)$/ })).toBeVisible();
}

/** The page's width against the window's, and any box inside the settings that scrolls sideways. */
function overflowOf(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('[data-testid="company-settings-shell"]');
    const workspace = document.querySelector('.ds-workspace__main');
    const nestedHorizontalScrollers = [...(shell?.querySelectorAll('*') || [])]
      .filter((element) => {
        const overflowX = getComputedStyle(element).overflowX;
        return ['auto', 'scroll'].includes(overflowX) && element.scrollWidth > element.clientWidth + 1;
      });
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      workspaceClientWidth: workspace?.clientWidth,
      workspaceScrollWidth: workspace?.scrollWidth,
      nestedHorizontalScrollerCount: nestedHorizontalScrollers.length,
    };
  });
}

test.describe('Company Settings shell and navigation compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes current-item semantics and keeps keyboard focus during tab switching', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSettings(page);

    const company = page.getByRole('button', { name: 'Company profile', exact: true });
    const application = page.getByRole('button', { name: 'Application questions', exact: true });

    await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveCount(0);
    await expect(company).toHaveAttribute('aria-current', 'page');
    await expect(company).toHaveAttribute('aria-controls', 'company-settings-content');

    await company.focus();
    await page.keyboard.press('ArrowDown');
    await expect(application).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(application).toBeFocused();
    await expect(application).toHaveAttribute('aria-current', 'page');
    await expect(company).not.toHaveAttribute('aria-current');
  });

  test('keeps the open section in the address, through a reload', async ({ page }) => {
    await openSettings(page);
    const email = page.getByRole('button', { name: 'Email', exact: true });

    await email.click();
    await expect(page).toHaveURL(/\/company\/settings\?e2eAuth=company_admin&section=email$/);

    await page.reload();
    await expect(email).toHaveAttribute('aria-current', 'page');
  });

  test('keeps the rail beside the section from 1181px: 288px wide, 40px from it, in view as the section scrolls', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop geometry check.');
    for (const width of [1181, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${SETTINGS_URL}&section=application`);
      await page.getByRole('tab', { name: 'Rules' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Application questions' })).toBeVisible();

      // Beside the rail the section is headed "Settings"; there is no way back to a menu.
      const content = page.getByRole('region', { name: 'Company settings content' });
      await expect(content.getByText('Settings', { exact: true })).toBeVisible();
      await expect(backToSettings(page)).toHaveCount(0);

      const rail = page.getByRole('navigation', { name: 'Company settings sections' });
      // A rail item is named by its label and described by its line, which is
      // drawn beside the button, so the button's visible text is its name
      // (WCAG 2.5.3); the whole row, line included, opens the section.
      const team = rail.getByRole('button', { name: 'Team', exact: true });
      await expect(team).toHaveAccessibleDescription('Who recruits for you');
      await expect(team).toHaveText('Team');
      await expect(rail.getByText('Who recruits for you', { exact: true })).toBeVisible();

      const geometry = await page.evaluate(() => {
        const navBox = document.querySelector('.ds-section-navigation').getBoundingClientRect();
        const contentBox = document.querySelector('#company-settings-content').getBoundingClientRect();
        const eyebrowBox = document.querySelector('#company-settings-content .ds-page-eyebrow').getBoundingClientRect();
        return {
          navWidth: navBox.width, gap: contentBox.left - navBox.right, navTop: navBox.top, eyebrowTop: eyebrowBox.top,
        };
      });
      expect(geometry.navWidth).toBe(288);
      expect(geometry.gap).toBe(40);
      expect(Math.abs(geometry.eyebrowTop - geometry.navTop)).toBeLessThanOrEqual(1);

      // The rules are long: scrolled to their end, the rail is still in view.
      const railTop = await page.evaluate(() => {
        const main = document.querySelector('.ds-workspace__main');
        main.scrollTop = main.scrollHeight;
        return document.querySelector('.ds-section-navigation').getBoundingClientRect().top
          - main.getBoundingClientRect().top;
      });
      expect(railTop).toBeGreaterThanOrEqual(0);
      expect(railTop).toBeLessThanOrEqual(40);

      const overflow = await overflowOf(page);
      expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
      expect(overflow.workspaceScrollWidth).toBeLessThanOrEqual(overflow.workspaceClientWidth);
      expect(overflow.nestedHorizontalScrollerCount).toBe(0);
    }
  });

  test('works like a phone on a tablet: the menu is its own page and each section links back to it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Tablet presentation check.');
    for (const width of [768, 1024, 1180]) {
      await page.setViewportSize({ width, height: 900 });
      await openSettings(page);

      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Company settings sections' })).toHaveCount(0);
      await expect(page).toHaveURL(/\/company\/settings\?e2eAuth=company_admin$/);

      const rowHeights = await page.evaluate(() => [...document.querySelectorAll('[data-testid="company-settings-shell"] .ds-selectable-card')]
        .map((row) => row.getBoundingClientRect().height));
      expect(rowHeights.length).toBeGreaterThan(0);
      expect(Math.min(...rowHeights)).toBeGreaterThanOrEqual(44);
      const menuOverflow = await overflowOf(page);
      expect(menuOverflow.documentWidth).toBeLessThanOrEqual(menuOverflow.viewportWidth);
      expect(menuOverflow.nestedHorizontalScrollerCount).toBe(0);

      await page.getByRole('button', { name: /^Application questions / }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Application questions' })).toBeVisible();
      await expect(page).toHaveURL(/section=application/);
      await expect(page.getByRole('navigation', { name: 'Company settings sections' })).toHaveCount(0);
      const sectionOverflow = await overflowOf(page);
      expect(sectionOverflow.documentWidth).toBeLessThanOrEqual(sectionOverflow.viewportWidth);
      expect(sectionOverflow.workspaceScrollWidth).toBeLessThanOrEqual(sectionOverflow.workspaceClientWidth);
      expect(sectionOverflow.nestedHorizontalScrollerCount).toBe(0);

      await backToSettings(page).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
      await expect(page).toHaveURL(/\/company\/settings\?e2eAuth=company_admin$/);
    }
  });

  test('opens on a menu of sections with no rail, and reaches every section from it @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openSettings(page);

    await expect(page.getByRole('navigation', { name: 'Company settings sections' })).toHaveCount(0);
    // Facebook leads shows only where a super admin switched it on, which the
    // fixture company has not; Plan and My profile are no longer sections.
    const sections = [
      'Company profile', 'Application questions', 'Team', 'Email', 'Text messages (SMS)', 'Automated texts',
      'API keys',
    ];
    for (const label of sections) {
      await expect(page.getByRole('button', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')} `) })).toBeAttached();
    }
    for (const gone of ['Facebook leads', 'Plan', 'My profile']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${gone} `) })).toHaveCount(0);
    }

    const geometry = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="company-settings-shell"]');
      const rows = [...(shell?.querySelectorAll('.ds-selectable-card') || [])].map((row) => row.getBoundingClientRect());
      const nestedHorizontalScrollers = [...(shell?.querySelectorAll('*') || [])]
        .filter((candidate) => {
          const overflowX = getComputedStyle(candidate).overflowX;
          return ['auto', 'scroll'].includes(overflowX)
            && candidate.scrollWidth > candidate.clientWidth + 1;
        });
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        minimumRowHeight: Math.min(...rows.map((box) => box.height)),
        rowRightEdge: Math.max(...rows.map((box) => box.right)),
        nestedHorizontalScrollerCount: nestedHorizontalScrollers.length,
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.minimumRowHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.rowRightEdge).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.nestedHorizontalScrollerCount).toBe(0);

    const apiKeys = page.getByRole('button', { name: /^API keys / });
    await apiKeys.scrollIntoViewIfNeeded();
    await apiKeys.click();
    await expect(page.getByRole('heading', { level: 1, name: 'API keys' })).toBeVisible();
    await expect(page).toHaveURL(/section=api_keys/);

    await backToSettings(page).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page).toHaveURL(/\/company\/settings\?e2eAuth=company_admin$/);
  });

  test('asks before the company menu leaves unsaved changes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'The company menu is beside the page from 768px up.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${SETTINGS_URL}&section=application`);
    await page.getByRole('tab', { name: 'Questions' }).click();
    await page.getByRole('switch', { name: 'Require Social Security Number' }).click();
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();

    const companyMenu = page.getByRole('navigation', { name: 'Company sections' });
    await companyMenu.getByRole('link', { name: 'Dashboard' }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(/section=application/);
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();

    await companyMenu.getByRole('link', { name: 'Dashboard' }).click();
    await page.getByRole('dialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Discard changes' }).click();
    await expect(page).toHaveURL(/\/company\/dashboard/);
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
