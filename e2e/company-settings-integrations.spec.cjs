// E2E coverage for the Company Settings "Integrations" tab
// (IntegrationsTab). This is a presentation-only migration: the SDK-load,
// login, Graph API and connectFacebookPage callable contracts are frozen and
// covered by IntegrationsTab.contract.test.jsx; the labelling/live-region/
// colour-only defects are covered by IntegrationsTab.a11y.test.jsx. This spec
// proves the reachable page renders, is accessible, never exposes a secret,
// and does not overflow at any supported width.
//
// The real Facebook SDK is not reachable from this environment. Until
// 2026-09-06 that left the "Connect Facebook" control in whichever state the
// network produced, and the keyboard test skipped on every CI run. The SDK is
// now stubbed at the network edge (`page.route` on connect.facebook.net), the
// same way the product code loads it — `window.fbAsyncInit` fires, `FB.init`
// runs, the button enables — so the enabled state is deterministic here and
// the "SDK Loading..." state stays covered by IntegrationsTab.contract.test.jsx.
// The stub's `FB.login` answers "popup closed" and counts its calls, so a
// keyboard activation can be asserted without a Facebook account.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

const FB_SDK_STUB = `
  window.__fbLoginCalls = 0;
  window.FB = {
    init() {},
    api() {},
    login(callback) { window.__fbLoginCalls += 1; callback({ status: 'unknown' }); },
  };
  if (typeof window.fbAsyncInit === 'function') window.fbAsyncInit();
`;

async function openIntegrationsTab(page) {
  await page.route('https://connect.facebook.net/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: FB_SDK_STUB }),
  );
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

  test('shows a reachable, named Connect Facebook control, enabled once the SDK has loaded', async ({ page }) => {
    await openIntegrationsTab(page);
    const connect = page.getByRole('button', { name: 'Connect Facebook' });
    await expect(connect).toBeVisible();
    // The SDK is stubbed at the network edge, so "loaded" is the state under
    // test; the announced "SDK Loading..." state while it is not is covered by
    // IntegrationsTab.contract.test.jsx, where the load can be held deterministically.
    await expect(connect).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByRole('status')).toHaveCount(0);
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

  test('reaches Connect Facebook by keyboard and activates it with Enter', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Keyboard walkthrough is a desktop lane.');
    await openIntegrationsTab(page);
    const connect = page.getByRole('button', { name: 'Connect Facebook' });
    // A native disabled button cannot receive focus at all (by design, not a
    // bug) — that IS the guard while the SDK hasn't loaded. With the SDK
    // stubbed, "loaded" is the state under test, so the button must be enabled.
    await expect(connect).toBeEnabled({ timeout: 15_000 });
    await connect.focus();
    await expect(connect).toBeFocused();

    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__fbLoginCalls)).toBe(1);
    // "Popup closed" is not an error: the control returns to idle, no alert.
    await expect(connect).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
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
