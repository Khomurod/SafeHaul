const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openCompanyInformation(page) {
  await page.goto(`${SETTINGS_URL}&section=company`);
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

  test('shows the plan as one read-only line, where an old Plan address now lands', async ({ page }) => {
    // Settings → Plan is gone; its address opens Company profile, other parameters kept.
    await page.goto(`${SETTINGS_URL}&section=billing`);
    await expect(page).toHaveURL(/\/company\/settings\?e2eAuth=company_admin&section=company$/);
    const information = page.getByTestId('company-information');
    await expect(information).toBeVisible();
    // The E2E company fixture carries no paid plan, so it resolves to Free Plan.
    await expect(information.getByText('Plan', { exact: true })).toBeVisible();
    await expect(information.getByText('Free Plan — to change it, contact support.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Plan/ })).toHaveCount(0);

    await enterEditMode(page);
    await expect(information.getByText(/Free Plan/)).toHaveCount(0);
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

  test('keeps the phone form to the card width but MC | DOT and State | Zip, Cancel and Save in a bar at the foot @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openCompanyInformation(page);
    await enterEditMode(page);

    const geometry = await page.evaluate(() => {
      const section = document.querySelector('[data-testid="company-information"]');
      const box = (name) => section.querySelector(`.ds-form-control[name="${name}"]`).getBoundingClientRect();
      const fields = [...section.querySelectorAll('.ds-form-control')];
      const bar = document.querySelector('.ds-page-header__actions');
      const barBox = bar.getBoundingClientRect();
      const actionButtons = [...bar.querySelectorAll('button')];

      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        sectionWidth: section.getBoundingClientRect().width,
        fullWidth: box('companyName').width,
        fullWidths: ['phone', 'email', 'street', 'city'].map((name) => box(name).width),
        pairs: [['mcNumber', 'dotNumber'], ['state', 'zip']].map(([a, b]) => ({
          widths: [box(a).width, box(b).width], sameRow: Math.abs(box(a).top - box(b).top) < 1,
        })),
        minimumFieldHeight: Math.min(...fields.map((field) => field.getBoundingClientRect().height)),
        bar: {
          position: getComputedStyle(bar).position,
          left: barBox.left, width: barBox.width, bottom: barBox.bottom,
          buttons: actionButtons.map((button) => button.textContent.trim()),
          minimumActionHeight: Math.min(...actionButtons.map((button) => button.getBoundingClientRect().height)),
        },
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.sectionWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.fullWidth).toBeGreaterThan(300);
    for (const width of geometry.fullWidths) expect(Math.abs(width - geometry.fullWidth)).toBeLessThan(1);
    for (const pair of geometry.pairs) {
      expect(pair.sameRow).toBe(true);
      for (const width of pair.widths) {
        expect(width).toBeGreaterThan(140);
        expect(width).toBeLessThan(geometry.fullWidth / 2);
      }
    }
    expect(geometry.minimumFieldHeight).toBeGreaterThanOrEqual(44);
    // Cancel and Save Changes once, in a bar fixed to the foot of the screen.
    expect(geometry.bar.position).toBe('fixed');
    expect(geometry.bar.left).toBe(0);
    expect(geometry.bar.width).toBe(geometry.viewportWidth);
    expect(Math.abs(geometry.bar.bottom - geometry.viewportHeight)).toBeLessThan(1);
    expect(geometry.bar.buttons).toEqual(['Cancel', 'Save Changes']);
    expect(geometry.bar.minimumActionHeight).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(1);

    // The last field, reached by keyboard, stops above the bar, not under it.
    const zip = page.getByRole('textbox', { name: 'Zip' });
    await zip.focus();
    await expect(zip).toBeVisible();
    const covered = await page.evaluate(() => {
      const zipBox = document.querySelector('[data-testid="company-information"] .ds-form-control[name="zip"]').getBoundingClientRect();
      return zipBox.bottom > document.querySelector('.ds-page-header__actions').getBoundingClientRect().top;
    });
    expect(covered).toBe(false);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Edit Profile' })).toBeFocused();
  });

  test('sets Contact Info and HQ Address side by side only where both have room @mobile', async ({ page }, testInfo) => {
    if (testInfo.project.name.startsWith('mobile')) {
      await page.setViewportSize({ width: 412, height: 915 });
      await openCompanyInformation(page);
      const stacked = await page.evaluate(() => {
        const [contact, address] = ['Contact Info', 'HQ Address'].map((name) => [...document.querySelectorAll('h2')]
          .find((heading) => heading.textContent === name).closest('section').getBoundingClientRect());
        return address.top >= contact.bottom;
      });
      expect(stacked).toBe(true);
      return;
    }
    for (const [width, sideBySide] of [[1440, true], [1366, false], [1024, false]]) {
      await page.setViewportSize({ width, height: 900 });
      await openCompanyInformation(page);
      const layout = await page.evaluate(() => {
        const [contact, address] = ['Contact Info', 'HQ Address'].map((name) => [...document.querySelectorAll('h2')]
          .find((heading) => heading.textContent === name).closest('section').getBoundingClientRect());
        return { sameRow: Math.abs(contact.top - address.top) < 1, stacked: address.top >= contact.bottom };
      });
      expect(layout.sameRow, `${width}px`).toBe(sideBySide);
      expect(layout.stacked, `${width}px`).toBe(!sideBySide);
    }
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
