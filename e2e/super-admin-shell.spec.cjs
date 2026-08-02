// E2E coverage for the migrated Super Admin shell (`SuperAdminDashboard`,
// `DashboardHeader`, `SuperAdminSidebar`).
//
// Before this spec the Super Admin area had **no** browser coverage at all —
// `e2eAuth=super_admin` was supported by `DataContext` but no spec used it. The
// data-bearing views behind the rail need Firestore, which is deliberately
// unreachable under `VITE_E2E_TEST_MODE=1` (the app forces the placeholder
// Firebase project so E2E can never touch real data), so what is reachable and
// asserted here is the shell itself: the landmarks, the named navigation and its
// `aria-current` state, view switching, the labelled global search, the
// accessible maintenance confirmation that replaced `window.confirm`, keyboard
// operation, axe, and overflow at three widths.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SUPER_ADMIN_URL = '/super-admin?e2eAuth=super_admin';

async function openShell(page) {
  await page.goto(SUPER_ADMIN_URL);
  await expect(page.getByRole('heading', { name: 'Super Admin', level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('navigation', { name: 'Super Admin sections' })).toBeVisible();
}

async function expectNoHorizontalOverflow(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe('Super Admin shell', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes named landmarks and a single h1', async ({ page }) => {
    await openShell(page);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1);
  });

  test('marks the active section with aria-current, not colour alone', async ({ page }) => {
    await openShell(page);
    const nav = page.getByRole('navigation', { name: 'Super Admin sections' });

    await expect(nav.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('button', { name: 'Companies' })).not.toHaveAttribute('aria-current', 'page');

    await nav.getByRole('button', { name: 'Companies' }).click();
    await expect(nav.getByRole('button', { name: 'Companies' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('button', { name: 'Dashboard' })).not.toHaveAttribute('aria-current', 'page');
  });

  test('reaches every Super Admin section from the rail', async ({ page }) => {
    await openShell(page);
    const nav = page.getByRole('navigation', { name: 'Super Admin sections' });

    for (const label of [
      'Dashboard', 'Analytics', 'Companies', 'Users', 'Unified Driver DB',
      'Global Features', 'SMS Integrations', 'Environment & Integrations',
      'Form Builder', 'System Health', 'Stats Backfill', 'Create New',
    ]) {
      await nav.getByRole('button', { name: label }).click();
      await expect(nav.getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('gives the global search an accessible name and a named clear control', async ({ page }) => {
    await openShell(page);
    const search = page.getByRole('searchbox', { name: /Search companies, users and driver applications/i });
    await expect(search).toBeVisible();

    // The clear control only exists once there is a query to clear.
    await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCount(0);
    await search.fill('artificial');
    await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toHaveValue('');
  });

  test('guards the employer backfill with a real dialog instead of window.confirm', async ({ page }) => {
    // If the blocking dialog ever comes back this fails loudly rather than hanging.
    let nativeDialogs = 0;
    page.on('dialog', async (d) => { nativeDialogs += 1; await d.dismiss(); });

    await openShell(page);
    await page.getByRole('button', { name: /Backfill Employers/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByText('Run employer field backfill?')).toBeVisible();

    // Focus must be inside the dialog, and Escape must dismiss it.
    await expect(dialog.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    expect(nativeDialogs, 'a native confirm/alert was used').toBe(0);
  });

  test('restores focus to the trigger when the maintenance dialog closes', async ({ page }) => {
    await openShell(page);
    const trigger = page.getByRole('button', { name: /Backfill Employers/i });
    await trigger.focus();
    await trigger.press('Enter');

    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('is operable by keyboard alone', async ({ page }) => {
    await openShell(page);
    const nav = page.getByRole('navigation', { name: 'Super Admin sections' });

    await nav.getByRole('button', { name: 'Dashboard' }).focus();
    // Tab order follows the rail, so the next item is reachable without a mouse.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(nav.getByRole('button', { name: 'Analytics' })).toHaveAttribute('aria-current', 'page');
  });

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await openShell(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
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
      await openShell(page);
      await expectNoHorizontalOverflow(page, `${label} super admin shell`);
    });
  }

  test('stays usable on a mobile device lane', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile device lane.');
    await openShell(page);
    // The rail becomes a horizontally scrollable strip below `sm`; the document
    // itself must still not overflow. This is the defect the old
    // `w-full shrink-0` rail caused inside a flex row.
    await expectNoHorizontalOverflow(page, 'mobile super admin shell');
    await page.getByRole('navigation', { name: 'Super Admin sections' })
      .getByRole('button', { name: 'Companies' }).click();
    await expectNoHorizontalOverflow(page, 'mobile super admin shell after navigation');
  });
});
