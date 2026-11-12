// E2E coverage for Company Settings → Text messages (SMS). Firestore is
// deliberately unreachable under VITE_E2E_TEST_MODE=1 and no `sms_provider` doc
// exists for the mock company, so the reachable state is the setup checklist.
// The configured page (phone lines, who texts from which line, the save bar,
// check/remove/default actions) is covered by the focused unit suites:
// sms/SmsSettingsPage.contract.test.jsx (the frozen 15-case token suite and
// more), sms/SmsSettingsPage.a11y.test.jsx, and SMSDiagnosticModal.*.test.jsx.
// This spec proves the reachable state renders, is accessible, and fits. The
// opted-out numbers under it come from `listSmsOptOuts`, answered here as the
// server would; sms/SmsOptOutSection.test.jsx covers adding and removing.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { SMS_OPT_OUTS, serveCallables } = require('./helpers/callables.cjs');

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openSmsTab(page) {
  await serveCallables(page, { listSmsOptOuts: SMS_OPT_OUTS });
  await page.goto(`${SETTINGS_URL}&section=sms`);
  await expect(page.getByRole('heading', { level: 1, name: 'Text messages (SMS)' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: /^Connect RingCentral/ })).toBeVisible({ timeout: 20_000 });
}

async function expectNoHorizontalOverflow(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe('Company Settings → Text messages (SMS)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('shows the four setup steps with a way to add the first line', async ({ page }) => {
    await openSmsTab(page);
    const steps = page.getByRole('list', { name: 'Setup steps' });
    await expect(steps.getByRole('listitem')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Add line' })).toBeVisible();
  });

  test('copies a request for SafeHaul support', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await openSmsTab(page);
    await page.getByRole('button', { name: 'Copy request for support' }).click();
    await expect(page.getByText('Request copied. Send it to SafeHaul support.')).toBeVisible();
  });

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await openSmsTab(page);
    const { violations } = await new AxeBuilder({ page })
      .include('[data-testid="sms-settings"]')
      .analyze();
    const severe = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}]`);
    expect(severe).toEqual([]);
  });

  for (const { label, width, height } of [
    { label: '1440', width: 1440, height: 900 },
    { label: '1024', width: 1024, height: 768 },
    { label: '412', width: 412, height: 915 },
  ]) {
    test(`fits ${label} px without document overflow`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith('mobile'), 'Explicit viewport sweep runs on the desktop lane.');
      await page.setViewportSize({ width, height });
      await openSmsTab(page);
      await expectNoHorizontalOverflow(page, `${label} SMS settings`);
    });
  }

  test('stays usable on a mobile device lane @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile device lane.');
    await openSmsTab(page);
    await expectNoHorizontalOverflow(page, 'mobile SMS settings');
    await expect(page.getByRole('button', { name: 'Add line' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove (555) 555-0142' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add number' })).toBeVisible();
  });

  test('lists the opted-out numbers and asks before removing one', async ({ page }) => {
    await openSmsTab(page);
    // The section is a region named by its heading; its table's scroll region
    // carries the same words, so the section is found by its test id.
    const section = page.getByTestId('sms-opt-outs');
    await expect(section).toHaveRole('region');
    await expect(section).toHaveAccessibleName('Opted-out numbers');
    await expect(section.getByText('From a STOP reply')).toBeVisible();
    await expect(section.getByText('By Maria-Annunziata Delacroix-Whitfield')).toBeVisible();

    await section.getByRole('button', { name: 'Remove (555) 555-0142' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove (555) 555-0142 from the list?' });
    await expect(dialog.getByText(/only when the driver asked to receive texts again/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    const { violations } = await new AxeBuilder({ page })
      .include('[data-testid="sms-opt-outs"]')
      .analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });
});
