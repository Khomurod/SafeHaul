const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

// The tab renders a loading state until its metadata callable settles. In the
// offline E2E environment that callable rejects, and the finally clause clears
// loading so the form renders in degraded (first-time-setup) mode. The settle
// can be slow offline, so the wait for the form is intentionally generous.
const FORM_TIMEOUT = 90_000;

async function selectEmail(page) {
  await page.goto(SETTINGS_URL);
  await page.getByRole('button', { name: 'Email Settings' }).click();
  await expect(page.getByTestId('email-settings')).toBeVisible();
}

async function openLoadedForm(page) {
  await selectEmail(page);
  await expect(page.getByRole('textbox', { name: /SMTP Host/i }))
    .toBeVisible({ timeout: FORM_TIMEOUT });
}

test.describe('Company Settings Email Settings compatibility slice', () => {
  test.describe.configure({ timeout: 120_000 });

  test('announces an accessible loading status while settings load', async ({ page }) => {
    await selectEmail(page);
    await expect(page.getByRole('status')).toContainText('Loading');
  });

  test('shows labelled SMTP fields, distinct actions, and a status banner on desktop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop presentation check.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLoadedForm(page);

    const region = page.getByTestId('email-settings');
    await expect(region.getByRole('textbox', { name: /SMTP Host/i })).toBeVisible();
    await expect(region.getByRole('spinbutton', { name: /SMTP Port/i })).toBeVisible();
    await expect(region.getByRole('textbox', { name: /SMTP Username/i })).toBeVisible();
    await expect(region.getByLabel(/SMTP Password/i)).toBeVisible();
    await expect(region.getByRole('textbox', { name: /Default Signature/i })).toBeVisible();

    // Offline E2E has no verified connection → the unverified banner shows.
    await expect(region.getByText('Not Connected / Unverified')).toBeVisible();

    // Distinct actions.
    await expect(region.getByRole('button', { name: 'Test Connection' })).toBeVisible();
    await expect(region.getByRole('button', { name: 'Save Settings' })).toBeVisible();

    // Setup-guide disclosure exposes expanded state.
    const guide = region.getByRole('button', { name: /How to Set Up SMTP/i });
    await expect(guide).toHaveAttribute('aria-expanded', 'false');
    await guide.click();
    await expect(guide).toHaveAttribute('aria-expanded', 'true');
    await expect(region.getByText('Gmail / Google Workspace')).toBeVisible();

    // Logical keyboard order across the SMTP inputs.
    await region.getByRole('textbox', { name: /SMTP Host/i }).focus();
    await page.keyboard.press('Tab');
    await expect(region.getByRole('spinbutton', { name: /SMTP Port/i })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(region.getByRole('textbox', { name: /SMTP Username/i })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(region.getByLabel(/SMTP Password/i)).toBeFocused();

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewportWidth);
  });

  test('keeps tablet layout free of document or nested horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Tablet geometry check.');
    await page.setViewportSize({ width: 1024, height: 768 });
    await openLoadedForm(page);

    const geometry = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="company-settings-shell"]');
      const content = document.querySelector('#company-settings-content');
      const controls = [...document.querySelectorAll(
        '[data-testid="email-settings"] .ds-form-control',
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
        controlCount: controls.length,
        minimumControlHeight: Math.min(...controls.map((c) => c.getBoundingClientRect().height)),
        nestedHorizontalScrollerCount: nestedHorizontalScrollers.length,
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.contentScrollWidth).toBeLessThanOrEqual(geometry.contentClientWidth);
    expect(geometry.controlCount).toBe(5); // host, port, user, password, signature
    expect(geometry.minimumControlHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.nestedHorizontalScrollerCount).toBe(0);
  });

  test('uses a single-column mobile layout without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openLoadedForm(page);

    const geometry = await page.evaluate(() => {
      const section = document.querySelector('[data-testid="email-settings"]');
      const controls = [...section.querySelectorAll('.ds-form-control')];
      const buttons = [...document.querySelectorAll('button')]
        .filter((b) => ['Test Connection', 'Save Settings'].includes(b.textContent.trim()));

      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        sectionRight: Math.round(section.getBoundingClientRect().right),
        minimumControlWidth: Math.min(...controls.map((c) => c.getBoundingClientRect().width)),
        minimumButtonHeight: Math.min(...buttons.map((b) => b.getBoundingClientRect().height)),
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.sectionRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.minimumControlWidth).toBeGreaterThan(250);
    expect(geometry.minimumButtonHeight).toBeGreaterThanOrEqual(44);
  });

  test('has no serious or critical accessibility violations in the loaded form', async ({ page }) => {
    await openLoadedForm(page);
    await page.getByRole('button', { name: /How to Set Up SMTP/i }).click();

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
