// E2E coverage for the Company Settings "Integrations" tab
// (IntegrationsTab). This is a presentation-only migration: the SDK-load,
// login, Graph API and connectFacebookPage callable contracts are frozen and
// covered by IntegrationsTab.contract.test.jsx; the labelling/live-region/
// colour-only defects are covered by IntegrationsTab.a11y.test.jsx. This spec
// proves the reachable page renders, is accessible, never exposes a secret,
// and does not overflow at any supported width.
//
// The real Facebook SDK is not reachable from this environment, so the
// "Connect Facebook" control may render either enabled (SDK loaded) or
// disabled with the "SDK Loading..." notice, depending on network
// reachability to connect.facebook.net — both are valid, frozen states, so
// assertions here do not depend on which one occurs.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openIntegrationsTab(page) {
  await page.goto(SETTINGS_URL);
  await expect(page.getByRole('button', { name: 'Integrations' })).toBeVisible();
  await page.getByRole('button', { name: 'Integrations' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Company Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Facebook Lead Ads' })).toBeVisible();
}

async function expectNoHorizontalOverflow(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe('Company Settings Integrations', () => {
  test.describe.configure({ timeout: 90_000 });

  test('renders the Facebook Lead Ads card and the "coming soon" placeholder', async ({ page }) => {
    await openIntegrationsTab(page);
    await expect(page.getByText('Automatically import leads from your Facebook Lead Gen forms.', { exact: false }))
      .toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'More Integrations Coming Soon' }))
      .toBeVisible();
  });

  test('shows a reachable, named Connect Facebook control in one of its two frozen states', async ({ page }) => {
    await openIntegrationsTab(page);
    const connect = page.getByRole('button', { name: /Connect Facebook|Connecting\.\.\./ });
    await expect(connect).toBeVisible();
    // Either state is valid: enabled once the SDK loads, or disabled with the
    // announced "SDK Loading..." notice while it hasn't.
    const isDisabled = await connect.isDisabled();
    if (isDisabled) {
      const status = page.getByRole('status');
      await expect(status).toBeVisible();
      expect(await status.textContent()).toContain('SDK Loading...');
    }
  });

  test('never renders a Facebook access token or app secret in the page', async ({ page }) => {
    await openIntegrationsTab(page);
    const html = await page.content();
    expect(html).not.toMatch(/FACEBOOK_APP_SECRET/i);
    expect(html).not.toMatch(/access_token=/i);
  });

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await openIntegrationsTab(page);
    const { violations } = await new AxeBuilder({ page })
      .include('#company-settings-content')
      .analyze();
    const severe = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}]`);
    expect(severe).toEqual([]);
  });

  test('reaches Connect Facebook by keyboard once it is enabled', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Keyboard walkthrough is a desktop lane.');
    await openIntegrationsTab(page);
    const connect = page.getByRole('button', { name: /Connect Facebook|Connecting\.\.\./ });
    // A native disabled button cannot receive focus at all (by design, not a
    // bug) — that IS the guard while the SDK hasn't loaded, so the keyboard
    // check only applies once it's enabled.
    if (await connect.isDisabled()) {
      test.skip(true, 'SDK did not finish loading in this environment; button stays disabled by design.');
    }
    await connect.focus();
    await expect(connect).toBeFocused();
  });

  for (const { label, width, height } of [
    { label: '1440', width: 1440, height: 900 },
    { label: '1024', width: 1024, height: 768 },
    { label: '412', width: 412, height: 915 },
  ]) {
    test(`fits ${label} px without document overflow`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith('mobile'), 'Explicit viewport sweep runs on the desktop lane.');
      await page.setViewportSize({ width, height });
      await openIntegrationsTab(page);
      await expectNoHorizontalOverflow(page, `${label} integrations`);
    });
  }

  test('stays usable on a mobile device lane', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile device lane.');
    await openIntegrationsTab(page);
    await expectNoHorizontalOverflow(page, 'mobile integrations');
  });
});
