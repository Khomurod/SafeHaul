// E2E coverage for the migrated Super Admin data/ops views behind the navigation
// rail (`e2e/super-admin-shell.spec.cjs` covers the shell itself).
//
// Under `VITE_E2E_TEST_MODE=1` the app points Firestore at a closed local port,
// so every view reaches its *settled* empty/error state rather than hanging.
// That is deliberately the state asserted here: it is the one reachable without
// a backend, and it is exactly the state the migration had to make announced,
// accessible and non-overflowing. Row-level behaviour (populated tables,
// toggles, dialogs, callable payloads) is covered by the focused unit suites,
// which can supply data deterministically.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SUPER_ADMIN_URL = '/super-admin?e2eAuth=super_admin';

/** Views reachable from the rail, with a stable landmark to wait on. */
const VIEWS = [
  { nav: 'Dashboard', expect: (page) => page.getByRole('heading', { name: 'Dashboard', level: 2 }) },
  { nav: 'Companies', expect: (page) => page.getByRole('heading', { name: 'Manage Companies' }) },
  // Every company's features, view only. Offline its table settles into the
  // announced load failure; the heading renders either way.
  { nav: 'Features', expect: (page) => page.getByRole('heading', { name: 'Features', level: 2 }) },
  { nav: 'Users', expect: (page) => page.getByRole('heading', { name: 'Manage All Users' }) },
  { nav: 'Unified Driver DB', expect: (page) => page.getByRole('heading', { name: 'Unified Driver Database' }) },
  // The configuration inventory. Offline its table settles into the announced
  // load failure (the callable is unreachable under VITE_E2E_TEST_MODE=1); the
  // page heading and the security notice render either way, so that is what is
  // waited on here. Row behaviour is covered by
  // `EnvironmentIntegrationsView.contract.test.jsx`.
  {
    nav: 'Environment & Integrations',
    expect: (page) => page.getByRole('heading', { name: 'Environment & Integrations', level: 2 }),
  },
  // Release Management. Offline the release-status callable is unreachable, so
  // this settles into the announced load failure with no release cards — which
  // is the correct state for "the screen cannot read the release status", and
  // the state in which the Release button must stay disabled. The populated
  // states are covered by `ReleaseManagementView.contract.test.jsx`.
  { nav: 'Releases', expect: (page) => page.getByRole('heading', { name: 'Releases', level: 2 }) },
  // Every platform-wide repair, each one that writes behind a confirmation.
  // Nothing on it reads data until asked, so it settles at once.
  { nav: 'Maintenance', expect: (page) => page.getByRole('heading', { name: 'Maintenance', level: 2 }) },
  { nav: 'System Health', expect: (page) => page.getByRole('heading', { name: 'System Health', level: 2 }) },
  { nav: 'Create New', expect: (page) => page.getByRole('heading', { name: 'Create New Entity' }) },
];

async function openShell(page) {
  await page.goto(SUPER_ADMIN_URL);
  await expect(page.getByRole('heading', { name: 'Super Admin', level: 1 })).toBeVisible({ timeout: 20_000 });
}

async function openMaintenance(page) {
  await openShell(page);
  await gotoView(page, 'Maintenance');
  await expect(page.getByRole('heading', { name: 'Maintenance', level: 2 })).toBeVisible({ timeout: 20_000 });
}

/**
 * Opens a confirmation from `trigger` by keyboard and dismisses it with Escape:
 * nothing runs, and focus is back on the trigger. No test here ever confirms —
 * these actions write to live data.
 */
async function expectConfirmationDismissed(page, trigger, title) {
  await trigger.focus();
  await trigger.press('Enter');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAccessibleName(title);
  // Focus lands inside, on Cancel, and Escape dismisses without running anything.
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function gotoView(page, navLabel) {
  const nav = page.getByRole('navigation', { name: 'Super Admin sections' });
  await nav.getByRole('button', { name: navLabel }).click();
}

async function expectNoHorizontalOverflow(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe('Super Admin views', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const view of VIEWS) {
    test(`${view.nav} renders its settled state`, async ({ page }) => {
      await openShell(page);
      await gotoView(page, view.nav);
      await expect(view.expect(page)).toBeVisible({ timeout: 20_000 });
    });

    test(`${view.nav} has no serious or critical accessibility violations`, async ({ page }) => {
      await openShell(page);
      await gotoView(page, view.nav);
      await expect(view.expect(page)).toBeVisible({ timeout: 20_000 });

      const { violations } = await new AxeBuilder({ page }).include('main').analyze();
      const severe = violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} [${v.impact}]`);
      expect(severe, `${view.nav} axe`).toEqual([]);
    });
  }

  // Offline the company cannot be read, so its screen settles on the failed
  // read (or "Company not found"): announced, with the way back, never a form.
  test("a company's screen settles on its read, with no serious accessibility violations", async ({ page }) => {
    await page.goto('/super-admin/companies/e2e-company/sms?e2eAuth=super_admin');
    await expect(page.getByRole('heading', { name: /^(Could not load this company|Company not found)$/ }))
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /All companies/ })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Select provider' })).toHaveCount(0);

    const { violations } = await new AxeBuilder({ page }).include('main').analyze();
    const severe = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}]`);
    expect(severe, 'company screen axe').toEqual([]);
  });

  test('every migrated view keeps exactly one h1 (the masthead)', async ({ page }) => {
    await openShell(page);
    for (const view of VIEWS) {
      await gotoView(page, view.nav);
      await expect(view.expect(page)).toBeVisible({ timeout: 20_000 });
      expect(await page.getByRole('heading', { level: 1 }).count(), `${view.nav} h1 count`).toBe(1);
    }
  });

  test('every Maintenance action that writes asks first; Escape runs nothing and returns focus', async ({ page }) => {
    let nativeDialogs = 0;
    page.on('dialog', async (d) => { nativeDialogs += 1; await d.dismiss(); });
    // One of these callables reached would be a confirmation that did not hold.
    const callables = [];
    page.on('request', (request) => {
      if (/backfillEmployerFields|backfillCompanyStats|backfillAllStats|backfillPublicProfiles/.test(request.url())) {
        callables.push(request.url());
      }
    });

    await openMaintenance(page);
    await expect(page.getByRole('heading', { name: 'Performance Stats Backfill', level: 3 })).toBeVisible();

    await expectConfirmationDismissed(page, page.getByRole('button', { name: /Backfill Employers/ }), 'Run employer field backfill?');
    await expectConfirmationDismissed(page, page.getByRole('button', { name: /Run All Companies/ }), 'Run the backfill for every company?');
    await page.getByLabel(/Company ID/).fill('e2e-artificial-company');
    await expectConfirmationDismissed(page, page.getByRole('button', { name: /Run Actual Backfill/ }), 'Run the backfill for this company?');
    await expectConfirmationDismissed(page, page.getByRole('button', { name: 'Sync Public Profiles' }), 'Rewrite every public profile?');

    expect(callables, 'a maintenance callable ran without a confirmation').toEqual([]);
    expect(nativeDialogs, 'a native confirm/alert was used').toBe(0);
  });

  test('Maintenance links to the screens that keep their own maintenance, keeping the sign-in query', async ({ page }) => {
    await openMaintenance(page);
    const nav = page.getByRole('navigation', { name: 'Super Admin sections' });

    await page.getByRole('link', { name: 'Releases' }).click();
    await expect(page).toHaveURL(/\/super-admin\/releases\?e2eAuth=super_admin$/);
    await expect(nav.getByRole('button', { name: 'Releases' })).toHaveAttribute('aria-current', 'page');
  });

  test("the Dashboard's Activity tab strip is keyboard operable", async ({ page }) => {
    await openShell(page);
    await expect(page.getByRole('heading', { name: 'Activity', level: 3 })).toBeVisible({ timeout: 20_000 });

    const tablist = page.getByRole('tablist', { name: 'Activity views' });
    // Offline, Firestore points at a closed port (see the header): the SDK goes
    // offline and the companies list comes back empty from its cache, so the
    // period settles with no calls and the strip renders — the same settled
    // state every other view here is asserted in. Wait for it: a single
    // `isVisible()` sample lands during "Loading activity…" and skips.
    await expect(tablist).toBeVisible({ timeout: 30_000 });

    await page.getByRole('tab', { name: 'Activity Overview' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Company Performance' })).toHaveAttribute('aria-selected', 'true');
  });

  // ---- The final three views of the Super Admin row ----

  test('System Health keeps the alerts and no maintenance action', async ({ page }) => {
    await openShell(page);
    await gotoView(page, 'System Health');
    await expect(page.getByRole('heading', { name: 'System Health', level: 2 })).toBeVisible({ timeout: 20_000 });

    await expect(page.getByRole('heading', { name: 'Telegram alerts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync Public Profiles' })).toHaveCount(0);
    await expect(page.getByRole('log')).toHaveCount(0);
  });

  test('Maintenance offers only the safe profile sync, named and described, with its log', async ({ page }) => {
    await openMaintenance(page);

    // Its explanation is visible help text, not a tooltip.
    await expect(page.getByRole('button', { name: 'Sync Public Profiles' }))
      .toHaveAccessibleDescription(/public_profiles/);
    // Never offered: they would write test accounts and schema defaults into
    // the live database.
    for (const name of [/Deep Diagnostic/, /Resume Test/, /Sync Backend Structure/, /Backfill SMS/, /^Reset/]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    // The output log stays a named, keyboard-focusable region.
    const log = page.getByRole('log', { name: 'System Output Log' });
    await expect(log).toBeVisible();
    await expect(log).toHaveAttribute('tabindex', '0');
  });

  test('Create New is a real tab interface with keyboard movement', async ({ page }) => {
    await openShell(page);
    await gotoView(page, 'Create New');
    await expect(page.getByRole('heading', { name: 'Create New Entity' })).toBeVisible({ timeout: 20_000 });

    const tablist = page.getByRole('tablist', { name: 'Entity type' });
    await expect(tablist).toBeVisible();
    await expect(page.getByRole('tab', { name: /New Company/ })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: /New Company/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /New User Only/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('Create New names every control and masks both passwords', async ({ page }) => {
    await openShell(page);
    await gotoView(page, 'Create New');
    await expect(page.getByRole('heading', { name: 'Create New Entity' })).toBeVisible({ timeout: 20_000 });

    // Three selects previously had no accessible name at all.
    await expect(page.getByLabel('Role')).toBeVisible();
    // The plan selector was two click-only divs; it is now a radio group.
    await expect(page.getByRole('radio', { name: /Free Plan/ })).toBeChecked();
    // Both password fields were type="text".
    await expect(page.getByLabel(/^Password/)).toHaveAttribute('type', 'password');

    await page.getByRole('tab', { name: /New User Only/ }).click();
    await expect(page.getByLabel(/Assign to Company/)).toBeVisible();
    await expect(page.getByLabel(/^Password/)).toHaveAttribute('type', 'password');
  });

  test('the Unified Driver DB bulk actions never report a false success', async ({ page }) => {
    let nativeDialogs = 0;
    page.on('dialog', async (d) => { nativeDialogs += 1; await d.dismiss(); });

    await openShell(page);
    await gotoView(page, 'Unified Driver DB');
    await expect(page.getByRole('heading', { name: 'Unified Driver Database' })).toBeVisible({ timeout: 20_000 });

    // Offline there are no rows to select, so the bar cannot appear at all —
    // which is itself the assertion that no bulk control is reachable here.
    await expect(page.getByRole('group', { name: 'Bulk actions for selected records' })).toHaveCount(0);
    expect(nativeDialogs, 'a native confirm/alert was used').toBe(0);
  });

  for (const { label, width, height } of [
    { label: '1440', width: 1440, height: 900 },
    { label: '1024', width: 1024, height: 768 },
    { label: '412', width: 412, height: 915 },
  ]) {
    test(`all migrated views fit ${label} px without document overflow`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith('mobile'), 'Explicit viewport sweep runs on the desktop lane.');
      await page.setViewportSize({ width, height });
      await openShell(page);

      for (const view of VIEWS) {
        await gotoView(page, view.nav);
        await expect(view.expect(page)).toBeVisible({ timeout: 20_000 });
        await expectNoHorizontalOverflow(page, `${label} ${view.nav}`);
      }
    });
  }

  // With rows: each status button's sr-only text needs a positioned parent, or
  // it lands past the table's right edge and widens the page.
  test('Companies with made-up rows fits 412 px without document overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Explicit viewport runs on the desktop lane.');
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/super-admin/companies?e2eAuth=super_admin&e2eCompanies=mock');
    await expect(page.getByRole('button', { name: 'View applications for Sample Haulage' })).toBeAttached({ timeout: 20_000 });
    await expectNoHorizontalOverflow(page, '412 Companies with rows');
  });

  test('all migrated views stay usable on a mobile device lane @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile device lane.');
    await openShell(page);

    for (const view of VIEWS) {
      await gotoView(page, view.nav);
      await expect(view.expect(page)).toBeVisible({ timeout: 20_000 });
      await expectNoHorizontalOverflow(page, `mobile ${view.nav}`);
    }
  });
});
