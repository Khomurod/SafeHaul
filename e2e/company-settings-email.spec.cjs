const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { serveCallables } = require('./helpers/callables.cjs');

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

// The tab renders a loading state until its metadata callable settles. In the
// offline E2E environment that callable rejects, and the finally clause clears
// loading so the form renders in degraded (first-time-setup) mode. The settle
// can be slow offline, so the wait for the form is intentionally generous.
const FORM_TIMEOUT = 90_000;

async function selectEmail(page) {
  await page.goto(`${SETTINGS_URL}&section=email`);
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
    // Hold the settings call open, so the page is still loading when it is read
    // (the placeholder project answers it at once with an error).
    await page.route('**/getEmailSettingsMeta', () => {});
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

    // Test Connection is always there; nothing is changed yet, so there is nothing to save.
    await expect(region.getByRole('button', { name: 'Test Connection' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toHaveCount(0);

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

    // One way to save: the bar appears once something changes, with the page's
    // only Save, and Discard puts the page back.
    const signature = region.getByRole('textbox', { name: /Default Signature/i });
    const before = await signature.inputValue();
    await signature.fill('Best regards, Dispatch');
    const bar = page.getByRole('region', { name: 'Unsaved changes' });
    await expect(bar).toContainText('1 change · Signature');
    await expect(region.getByRole('button', { name: /save/i })).toHaveCount(1);
    await bar.getByRole('button', { name: 'Discard' }).click();
    await expect(bar).toHaveCount(0);
    await expect(signature).toHaveValue(before);
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
    expect(geometry.controlCount).toBe(6); // host, port, user, password, signature, verification copies
    expect(geometry.minimumControlHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.nestedHorizontalScrollerCount).toBe(0);
  });

  test('uses a single-column mobile layout without horizontal overflow @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openLoadedForm(page);
    // A change brings the save bar, whose Discard and Save are measured too.
    await page.getByRole('textbox', { name: /Default Signature/i }).fill('Best regards, Dispatch');
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const section = document.querySelector('[data-testid="email-settings"]');
      const controls = [...section.querySelectorAll('.ds-form-control')];
      const bar = section.querySelector('[role="region"][aria-label="Unsaved changes"]');
      const buttons = [...section.querySelectorAll('button')]
        .filter((b) => ['Test Connection', 'Discard', 'Save'].includes(b.textContent.trim()));

      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        sectionRight: Math.round(section.getBoundingClientRect().right),
        barRight: Math.round(bar.getBoundingClientRect().right),
        buttonCount: buttons.length,
        minimumControlWidth: Math.min(...controls.map((c) => c.getBoundingClientRect().width)),
        minimumButtonHeight: Math.min(...buttons.map((b) => b.getBoundingClientRect().height)),
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.sectionRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.barRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.buttonCount).toBe(3);
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

// Send from Gmail. `?e2eGmail=on` switches it on for the fixture company, as a
// super admin does. The Email tab learns whether Gmail is connected from
// `getEmailSettingsMeta`, answered here at the network edge; Google's consent
// page is answered too, so nothing leaves the machine. Every address is made up.
const GMAIL_URL = `${SETTINGS_URL}&e2eGmail=on&section=email`;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const KEPT = 'Your mail-server settings are kept and used again if you disconnect Gmail.';
const GMAIL_ACTIVE = {
  connected: true, email: 'hiring@example.test', status: 'active', statusReason: null,
  // Noon on Nov 30 where the browser is (the same machine), so the day reads the same everywhere.
  connectedAt: new Date(2026, 10, 30, 12).getTime(), connectedByName: 'Artificial Admin',
};

/** `getEmailSettingsMeta` as the server answers it, with this Gmail. */
const emailMeta = (gmail) => ({
  success: true,
  settings: {
    smtpHost: 'smtp.example.test', smtpPort: 587, smtpUser: 'ops@example.test', signature: 'Best regards',
    isVerified: true, hasPassword: true, updatedAt: null, gmail,
  },
});

async function expectNoSevereViolations(page, include) {
  const { violations } = await new AxeBuilder({ page }).include(include).analyze();
  const severe = violations
    .filter((violation) => ['serious', 'critical'].includes(violation.impact))
    .flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')}`));
  expect(severe).toEqual([]);
}

async function expectNoHorizontalOverflow(page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe('Company Settings Email: Send from Gmail', () => {
  test.describe.configure({ timeout: 120_000 });

  test('offers Connect Gmail where switched on, and holds it while changes are unsaved', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop check.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(GMAIL_URL);
    const card = page.getByRole('region', { name: 'Send from Gmail' });
    await expect(card).toContainText("SafeHaul can only send; it cannot read your mailbox.", { timeout: FORM_TIMEOUT });
    const connect = card.getByRole('button', { name: 'Connect Gmail' });
    await expect(connect).toBeEnabled();
    // The mail-server form is still there, under the card.
    await expect(page.getByRole('textbox', { name: /SMTP Host/i })).toBeVisible();

    await page.getByRole('textbox', { name: /Default Signature/i }).fill('Best regards, Dispatch');
    await expect(connect).toBeDisabled();
    await expect(connect).toHaveAccessibleDescription('Save or discard your changes first.');
    await page.getByRole('region', { name: 'Unsaved changes' }).getByRole('button', { name: 'Discard' }).click();
    await expect(connect).toBeEnabled();
    await expectNoHorizontalOverflow(page);
    await expectNoSevereViolations(page, '#company-settings-content');
  });

  test('shows each connected state, the mail-server form folded into one line', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop check.');
    await page.setViewportSize({ width: 1440, height: 900 });
    let gmail = GMAIL_ACTIVE;
    await page.route('**/getEmailSettingsMeta', (route) => (route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ result: emailMeta(gmail) }) })));
    const card = page.getByRole('region', { name: 'Send from Gmail' });

    await page.goto(GMAIL_URL);
    await expect(page.getByText(KEPT)).toBeVisible({ timeout: FORM_TIMEOUT });
    await expect(card).toContainText('Sending from hiring@example.test · connected by Artificial Admin on Nov 30, 2026');
    await expect(card.getByRole('button', { name: 'Send test email' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /SMTP Host/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Test Connection' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /Default Signature/i })).toHaveValue('Best regards');
    await expectNoSevereViolations(page, '#company-settings-content');

    await card.getByRole('button', { name: 'Disconnect' }).click();
    const dialog = page.getByRole('dialog', { name: 'Disconnect Gmail?' });
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expectNoSevereViolations(page, '[role="dialog"]');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    gmail = { ...GMAIL_ACTIVE, status: 'needs_reconnect', statusReason: 'invalid_grant' };
    await page.reload();
    await expect(card).toContainText('Emails are not being sent', { timeout: FORM_TIMEOUT });
    await expect(card.getByRole('button', { name: 'Reconnect Gmail' })).toBeEnabled();
    await expectNoSevereViolations(page, '#company-settings-content');

    // Switched off, a connected Gmail keeps sending until it is disconnected.
    gmail = GMAIL_ACTIVE;
    await page.goto(`${SETTINGS_URL}&section=email`);
    await expect(card).toContainText('Send from Gmail is switched off', { timeout: FORM_TIMEOUT });
    await expect(card.getByRole('button', { name: /Connect Gmail/ })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  });

  test("goes to Google's page and back, and the code leaves the address at once", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop check.');
    await serveCallables(page, {
      startGmailConnection: { url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=e2e&state=E2E-STATE' },
    });
    await page.route('https://accounts.google.com/**', (route) => route.fulfill({
      status: 200, contentType: 'text/html', body: '<!doctype html><title>Google</title><p>Choose an account</p>',
    }));
    await page.goto(GMAIL_URL);
    await page.getByRole('button', { name: 'Connect Gmail' }).click({ timeout: FORM_TIMEOUT });
    await page.waitForURL(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);

    // Google sends the admin back with a one-time code; the server's answer is held.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let sent = null;
    await page.route('**/completeGmailConnection', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      sent = route.request().postDataJSON()?.data;
      await held;
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ result: { email: 'hiring@example.test' } }) });
    });
    await serveCallables(page, { getEmailSettingsMeta: emailMeta(GMAIL_ACTIVE) });
    await page.goto('/oauth/google/callback?code=E2E-CODE&state=E2E-STATE&e2eAuth=company_admin&e2eGmail=on');

    await expect(page.getByRole('heading', { level: 1, name: 'Connecting Gmail…' })).toBeVisible();
    await expect.poll(() => sent).toEqual({ code: 'E2E-CODE', state: 'E2E-STATE' });
    // Before the server has answered, the address holds no code.
    expect(new URL(page.url()).search).toBe('');
    expect(page.url()).not.toContain('E2E-CODE');
    release();

    await expect(page).toHaveURL(/\/company\/settings\?section=email$/);
    await expect(page.getByText('Gmail connected: hiring@example.test')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Send from Gmail' })).toContainText('Sending from hiring@example.test', { timeout: FORM_TIMEOUT });
  });

  test('goes back to Email settings when the admin cancelled at Google', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop check.');
    await page.goto('/oauth/google/callback?error=access_denied&state=E2E-STATE&e2eAuth=company_admin&e2eGmail=on');
    await expect(page).toHaveURL(/\/company\/settings\?section=email$/);
    await expect(page.getByText('Gmail was not connected.')).toBeVisible();
  });

  test("says the server's reason when the connection is refused, on a phone too @mobile", async ({ page }) => {
    await page.route('**/completeGmailConnection', (route) => (route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({
        status: 403, headers: CORS, contentType: 'application/json',
        body: JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Sign in as the person who started connecting Gmail, then try again.' } }),
      })));
    await page.goto('/oauth/google/callback?code=E2E-CODE&state=E2E-OTHER&e2eAuth=company_admin');

    await expect(page.getByRole('heading', { level: 1, name: 'Gmail was not connected' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Sign in as the person who started connecting Gmail, then try again.');
    expect(new URL(page.url()).search).toBe('');
    await expectNoHorizontalOverflow(page);
    await expectNoSevereViolations(page, 'main');

    await page.getByRole('button', { name: 'Back to Email settings' }).click();
    await expect(page).toHaveURL(/\/company\/settings\?section=email$/);
  });

  test('fits the Gmail card on a phone, connected and not @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(GMAIL_URL);
    const card = page.getByRole('region', { name: 'Send from Gmail' });
    const connect = card.getByRole('button', { name: 'Connect Gmail' });
    await expect(connect).toBeVisible({ timeout: FORM_TIMEOUT });
    await expectNoHorizontalOverflow(page);
    expect((await connect.boundingBox()).height).toBeGreaterThanOrEqual(44);

    await serveCallables(page, { getEmailSettingsMeta: emailMeta(GMAIL_ACTIVE) });
    await page.reload();
    await expect(page.getByText(KEPT)).toBeVisible({ timeout: FORM_TIMEOUT });
    await expectNoHorizontalOverflow(page);
    for (const name of ['Send test email', 'Disconnect']) {
      const action = card.getByRole('button', { name });
      await expect(action).toBeVisible();
      const box = await action.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(413);
    }
    await expectNoSevereViolations(page, '#company-settings-content');
  });
});
