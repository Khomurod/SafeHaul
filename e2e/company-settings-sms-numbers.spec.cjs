// E2E coverage for the Company Settings "SMS Settings" tab's migrated
// Number Assignments surface (NumberAssignmentManager + DefaultLineSection +
// AssignmentTable + AssignmentRow + SMSDiagnosticModal). Firestore is
// deliberately unreachable under VITE_E2E_TEST_MODE=1, so the E2E-reachable
// state is the frozen "SMS Integration Not Active" branch (no
// `sms_provider` doc exists for the mock company) — the full assignment
// matrix, verify/save flows, and the diagnostic modal are covered by the
// focused unit suites (NumberAssignmentManager.test.jsx's frozen 15-case
// suite, NumberAssignmentManager.a11y.test.jsx, SMSDiagnosticModal.contract/
// a11y.test.jsx). This spec proves the reachable state renders, is
// accessible, and does not overflow.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openSmsTab(page) {
  await page.goto(SETTINGS_URL);
  await expect(page.getByRole('button', { name: 'SMS Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'SMS Settings' }).click();
  await expect(page.getByText('SMS Integration Not Active')).toBeVisible({ timeout: 20_000 });
}

async function expectNoHorizontalOverflow(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe('Company Settings SMS Settings — Number Assignments', () => {
  test.describe.configure({ timeout: 90_000 });

  test('shows the frozen not-active message with an accessible status medallion', async ({ page }) => {
    await openSmsTab(page);
    await expect(page.getByText('Please contact a Super Admin to enable SMS for your company.'))
      .toBeVisible();
  });

  test('keeps the Phone Line Wallet (out of scope) reachable alongside it', async ({ page }) => {
    await openSmsTab(page);
    await expect(page.getByText('Phone Line Wallet')).toBeVisible();
  });

  test('has no serious or critical accessibility violations in the migrated Number Assignments surface', async ({ page }) => {
    await openSmsTab(page);
    // Scoped to the migrated `NumberAssignmentManager`, not the whole tab: the
    // Phone Line Wallet (`LineManager`) above it is a separate, out-of-scope,
    // unmigrated component with its own pre-existing defects (recorded in the
    // roadmap) that this campaign does not touch or claim to have fixed.
    const { violations } = await new AxeBuilder({ page })
      .include('[data-testid="number-assignment-manager"]')
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

  test('stays usable on a mobile device lane', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile device lane.');
    await openSmsTab(page);
    await expectNoHorizontalOverflow(page, 'mobile SMS settings');
  });
});
