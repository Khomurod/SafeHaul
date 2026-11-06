// E2E coverage for the CampaignResultsTable design-system migration. The table
// only mounts inside CampaignDetails, so the flow opens a completed session from
// the dashboard's e2eCampaign=mock seed; the table itself is populated by its own
// guarded E2E seed (artificial recipients + fictional 555-01xx contacts — never
// real recipient data). Verifies the populated table, status treatment, labelled
// search filtering, the empty-search state, responsive overflow at 1440/1024/412,
// and an axe pass scoped to the migrated table. `e2eCampaignLogs=paged` serves the
// same 12 rows 5 at a time, for Load more and where it leaves keyboard focus.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock';
const PAGED_URL = `${URL}&e2eCampaignLogs=paged`;

async function openResults(page, url = URL) {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: /Sent & live/i }).click();
  await expect(page.getByText('E2E Completed Session')).toBeVisible();
  await page.getByRole('button', { name: /^Details$/i }).first().click();
  await expect(page.getByRole('table', { name: 'Recipient delivery log' })).toBeVisible({ timeout: 20_000 });
}

test.describe('Campaign results table slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('renders the populated log with text-based status treatment', async ({ page }) => {
    await openResults(page);

    for (const header of ['Recipient', 'Contact', 'Status', 'Time']) {
      await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
    }
    await expect(page.getByText('E2E Recipient 1', { exact: true })).toBeVisible();
    // Status is icon + text, never colour-only.
    await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Delivered', { exact: true })).toBeVisible();
    await expect(page.getByText('Awaiting delivery', { exact: true })).toBeVisible();
    await expect(page.getByText('RingCentral has not confirmed delivery yet.')).toBeVisible();
    await expect(page.getByText('Not sent', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Carrier rejected the message.').first()).toBeVisible();
  });

  test('offers Check delivery for an SMS campaign that has sent', async ({ page }) => {
    await openResults(page);
    // Not clicked: the check would call the real server.
    await expect(page.getByRole('button', { name: 'Check delivery' })).toBeVisible();
  });

  test('filters through the labelled search and shows the empty-search state', async ({ page }) => {
    await openResults(page);

    const search = page.getByLabel('Search recipients by name or contact');
    await expect(search).toBeVisible();

    await search.fill('555-0105');
    await expect(page.getByText('E2E Recipient 6', { exact: true })).toBeVisible();
    await expect(page.getByText('E2E Recipient 1', { exact: true })).toHaveCount(0);

    await search.fill('no-such-recipient');
    await expect(page.getByText('No recipients match your search.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Recipient delivery log' })).toBeVisible();
  });

  test('keeps the document within the viewport on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await openResults(page);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a mobile layout without document-level horizontal overflow @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openResults(page);
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious/critical or contrast violations in the results table', async ({ page }) => {
    await openResults(page);
    const { violations } = await new AxeBuilder({ page }).include('table').analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });

  test('loads the next recipients on request and keeps keyboard focus on the control', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await openResults(page, PAGED_URL);
    const table = page.getByRole('table', { name: 'Recipient delivery log' });
    const loadMore = page.getByRole('button', { name: 'Load more recipients' });

    await expect(page.getByText('Showing the newest 5 of 12 recipients.')).toBeVisible();
    await expect(table.getByRole('rowheader')).toHaveCount(5);
    // The last row of the default fixture is not on the first page.
    await expect(table.getByRole('rowheader', { name: 'E2E Recipient 12' })).toHaveCount(0);

    await loadMore.press('Enter');
    await expect(table.getByRole('rowheader')).toHaveCount(10);
    await expect(page.getByText('Showing the newest 10 of 12 recipients.')).toBeVisible();
    await expect(loadMore).toBeFocused();

    await loadMore.press('Enter');
    await expect(table.getByRole('rowheader')).toHaveCount(12);
    await expect(loadMore).toHaveCount(0);
    const done = page.locator('.ds-notice', { hasText: 'All 12 recipients are shown.' });
    await expect(done).toBeVisible();
    await expect(done).toBeFocused();

    const card = '.ds-card[data-padding="none"]';
    await expect(page.locator(card)).toHaveCount(1);
    const { violations } = await new AxeBuilder({ page }).include(card).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });

  test('keeps the paged log within a phone viewport @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openResults(page, PAGED_URL);
    await expect(page.getByText('Showing the newest 5 of 12 recipients.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load more recipients' })).toBeVisible();
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });
});
