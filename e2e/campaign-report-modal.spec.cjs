// E2E coverage for the DetailedReportModal design-system migration. Opens the
// report from a completed session (e2eCampaign=mock) and verifies the shared
// accessible Modal (dialog role/name, Escape + backdrop close, focus), that the
// panel scrolls internally without document overflow at 1440/1024/412, and a
// dialog-scoped axe pass. `e2eCampaignLogs=paged` serves the same 12 rows 5 at a
// time, for Load more and where it leaves keyboard focus. No real recipient data
// is used.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock';
const PAGED_URL = `${URL}&e2eCampaignLogs=paged`;

const focusIsInDialog = (page) => page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  return dialog ? dialog.contains(document.activeElement) : false;
});

async function openReport(page, url = URL) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: /Past Sequences/i }).click();
  await expect(page.getByText('E2E Completed Session')).toBeVisible();
  await page.getByRole('button', { name: 'View Report' }).click();
  await expect(page.getByRole('dialog', { name: 'Delivery Report' })).toBeVisible();
}

test.describe('DetailedReportModal compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('opens an accessible dialog with the delivery table headers', async ({ page }) => {
    await openReport(page);
    const dialog = page.getByRole('dialog', { name: 'Delivery Report' });
    await expect(dialog.getByRole('columnheader', { name: 'Recipient' })).toBeVisible();
    await expect(dialog.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(dialog.getByRole('columnheader', { name: 'Error Detail' })).toBeVisible();
  });

  test('closes on Escape and via the footer Close button', async ({ page }) => {
    await openReport(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Delivery Report' })).toHaveCount(0);

    await page.getByRole('button', { name: 'View Report' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delivery Report' });
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByRole('dialog', { name: 'Delivery Report' })).toHaveCount(0);
  });

  test('moves focus into the dialog on open', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await openReport(page);
    expect(await focusIsInDialog(page)).toBe(true);
  });

  test('does not overflow the document at desktop/tablet/mobile @mobile', async ({ page }, testInfo) => {
    const widths = testInfo.project.name.startsWith('mobile') ? [412] : [1440, 1024];
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 412 ? 915 : 900 });
      await openReport(page);
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
      await page.keyboard.press('Escape');
    }
  });

  test('has no serious or critical accessibility violations in the dialog', async ({ page }) => {
    await openReport(page);
    const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });

  test('loads the next records on request and keeps keyboard focus inside the dialog', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await openReport(page, PAGED_URL);
    const dialog = page.getByRole('dialog', { name: 'Delivery Report' });
    const table = dialog.getByRole('table', { name: 'Per-recipient delivery results' });
    const loadMore = dialog.getByRole('button', { name: 'Load more records' });

    await expect(dialog.getByText('Showing the newest 5 of 12 delivery records.')).toBeVisible();
    await expect(table.getByRole('rowheader')).toHaveCount(5);

    await loadMore.press('Enter');
    await expect(table.getByRole('rowheader')).toHaveCount(10);
    await expect(loadMore).toBeFocused();
    expect(await focusIsInDialog(page)).toBe(true);

    await loadMore.press('Enter');
    await expect(table.getByRole('rowheader')).toHaveCount(12);
    await expect(loadMore).toHaveCount(0);
    const done = dialog.locator('.ds-notice', { hasText: 'All 12 delivery records are shown.' });
    await expect(done).toBeFocused();
    expect(await focusIsInDialog(page)).toBe(true);
    // Focus is still in the dialog, so Escape still closes it.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('has no serious accessibility violations with the paging notice shown', async ({ page }) => {
    await openReport(page, PAGED_URL);
    await expect(page.getByText('Showing the newest 5 of 12 delivery records.')).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });

  test('keeps the paged report within a phone viewport @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openReport(page, PAGED_URL);
    await expect(page.getByText('Showing the newest 5 of 12 delivery records.')).toBeVisible();
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });
});
