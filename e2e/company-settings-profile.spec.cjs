const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openPersonalProfile(page) {
  await page.goto(SETTINGS_URL);
  await expect(page.getByRole('button', { name: 'Company Profile' })).toBeVisible();
  await page.getByRole('button', { name: 'Security Profile' }).click();
  await expect(page.getByRole('heading', { name: 'Personal Profile', exact: true }))
    .toBeVisible();
}

test.describe('Company Settings Personal Profile compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('keeps native field relationships, keyboard order, and focus visibility', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPersonalProfile(page);

    const name = page.getByRole('textbox', { name: 'Full Name' });
    const email = page.getByRole('textbox', { name: 'Email' });
    const update = page.getByRole('button', { name: 'Update Profile' });

    await expect(email).toHaveValue('company_admin@safehaul.local');
    await expect(email).toHaveAttribute('readonly', '');
    await expect(email).toHaveAttribute(
      'aria-describedby',
      'personal-profile-email-description',
    );

    await name.focus();
    await expect(name).toBeFocused();
    const focusPresentation = await name.evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        boxShadow: styles.boxShadow,
        outline: styles.outlineStyle,
      };
    });
    expect(
      focusPresentation.boxShadow !== 'none' ||
      focusPresentation.outline !== 'none',
    ).toBe(true);

    await page.keyboard.press('Tab');
    await expect(email).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(update).toBeFocused();

    const [labelBox, controlBox] = await Promise.all([
      page.getByText('Full Name', { exact: true }).boundingBox(),
      name.boundingBox(),
    ]);
    expect(labelBox).not.toBeNull();
    expect(controlBox).not.toBeNull();
    expect(Math.abs(labelBox.x - controlBox.x)).toBeLessThan(1);
  });

  test('keeps the laptop layout inside the viewport with readable control density', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Laptop geometry check.');
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPersonalProfile(page);

    const geometry = await page.evaluate(() => {
      const name = document.querySelector('#personal-profile-name');
      const email = document.querySelector('#personal-profile-email');
      const main = document.querySelector('main');
      const workspaceMain = document.querySelector('.ds-workspace__main');
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        mainWidth: main?.getBoundingClientRect().width,
        workspaceClientWidth: workspaceMain?.clientWidth,
        workspaceScrollWidth: workspaceMain?.scrollWidth,
        nameHeight: name?.getBoundingClientRect().height,
        emailHeight: email?.getBoundingClientRect().height,
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.mainWidth).toBeGreaterThan(600);
    expect(geometry.workspaceScrollWidth).toBeLessThanOrEqual(
      geometry.workspaceClientWidth,
    );
    expect(geometry.nameHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.emailHeight).toBeGreaterThanOrEqual(44);
  });

  test('uses a single-column mobile presentation without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openPersonalProfile(page);

    const geometry = await page.evaluate(() => {
      const main = document.querySelector('main');
      const name = document.querySelector('#personal-profile-name');
      const email = document.querySelector('#personal-profile-email');
      const update = [...document.querySelectorAll('button')]
        .find((element) => element.textContent.includes('Update Profile'));
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        mainWidth: main?.getBoundingClientRect().width,
        nameWidth: name?.getBoundingClientRect().width,
        emailWidth: email?.getBoundingClientRect().width,
        updateHeight: update?.getBoundingClientRect().height,
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.mainWidth).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.nameWidth).toBeGreaterThan(250);
    expect(geometry.emailWidth).toBeGreaterThan(250);
    expect(geometry.updateHeight).toBeGreaterThanOrEqual(44);
    await expect(page.getByText('Email cannot be changed directly.')).toBeVisible();
  });

  test('has no serious or critical accessibility violations in the migrated content', async ({ page }) => {
    await openPersonalProfile(page);

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
