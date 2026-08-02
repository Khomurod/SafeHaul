const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openCompanyInformation(page) {
  await page.goto(SETTINGS_URL);
  await expect(page.getByTestId('company-information')).toBeVisible();
}

async function enterEditMode(page) {
  await page.getByRole('button', { name: 'Edit Profile' }).click();
  await expect(page.getByRole('textbox', { name: 'Company Name' })).toBeVisible();
}

test.describe('Company Settings Company Profile information compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('loads existing values and provides logical keyboard order and focus', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCompanyInformation(page);

    await expect(
      page.getByTestId('company-information')
        .getByText('E2E Logistics', { exact: true }),
    ).toBeVisible();
    await enterEditMode(page);

    const companyName = page.getByRole('textbox', { name: 'Company Name' });
    const mcNumber = page.getByRole('textbox', { name: 'MC Number' });
    const dotNumber = page.getByRole('textbox', { name: 'DOT Number' });

    await expect(companyName).toHaveValue('E2E Logistics');
    await expect(companyName).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(mcNumber).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dotNumber).toBeFocused();

    const focusPresentation = await dotNumber.evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        outline: styles.outlineStyle,
        boxShadow: styles.boxShadow,
      };
    });
    expect(
      focusPresentation.outline !== 'none'
      || focusPresentation.boxShadow !== 'none',
    ).toBe(true);
  });

  test('keeps tablet fields aligned without document or nested overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Tablet geometry check.');
    await page.setViewportSize({ width: 1024, height: 768 });
    await openCompanyInformation(page);
    await enterEditMode(page);

    const geometry = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="company-settings-shell"]');
      const content = document.querySelector('#company-settings-content');
      const fields = [...document.querySelectorAll(
        '[data-testid="company-information"] .ds-form-control',
      )];
      const labels = [...document.querySelectorAll(
        '[data-testid="company-information"] .ds-label',
      )];
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
        fieldCount: fields.length,
        minimumFieldHeight: Math.min(...fields.map((field) => field.getBoundingClientRect().height)),
        allLabelsAlign: fields.every((field, index) => (
          Math.abs(field.getBoundingClientRect().left - labels[index].getBoundingClientRect().left) < 1
        )),
        nestedHorizontalScrollerCount: nestedHorizontalScrollers.length,
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.contentScrollWidth).toBeLessThanOrEqual(geometry.contentClientWidth);
    expect(geometry.fieldCount).toBe(9);
    expect(geometry.minimumFieldHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.allLabelsAlign).toBe(true);
    expect(geometry.nestedHorizontalScrollerCount).toBe(0);
  });

  test('uses a single-column mobile form with wrapping and no overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openCompanyInformation(page);
    await enterEditMode(page);

    const geometry = await page.evaluate(() => {
      const section = document.querySelector('[data-testid="company-information"]');
      const fields = [...section.querySelectorAll('.ds-form-control')];
      const actionButtons = [...document.querySelectorAll('button')]
        .filter((button) => ['Cancel', 'Save Changes'].includes(button.textContent.trim()));

      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        sectionWidth: section.getBoundingClientRect().width,
        minimumFieldWidth: Math.min(...fields.map((field) => field.getBoundingClientRect().width)),
        minimumFieldHeight: Math.min(...fields.map((field) => field.getBoundingClientRect().height)),
        minimumActionHeight: Math.min(...actionButtons.map((button) => button.getBoundingClientRect().height)),
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.sectionWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.minimumFieldWidth).toBeGreaterThan(250);
    expect(geometry.minimumFieldHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.minimumActionHeight).toBeGreaterThanOrEqual(44);

    const street = page.getByRole('textbox', { name: 'Street' });
    await street.scrollIntoViewIfNeeded();
    await expect(street).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Edit Profile' })).toBeFocused();
  });

  test('has no serious or critical accessibility violations in edit mode', async ({ page }) => {
    await openCompanyInformation(page);
    await enterEditMode(page);

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
