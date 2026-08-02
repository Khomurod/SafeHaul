// E2E coverage for the CampaignResultsTable design-system migration. The table
// only mounts inside CampaignDetails, so the flow opens a completed session from
// the dashboard's e2eCampaign=mock seed; the table itself is populated by its own
// guarded E2E seed (artificial recipients + fictional 555-01xx contacts — never
// real recipient data). Verifies the populated table, status treatment, labelled
// search filtering, the empty-search state, responsive overflow at 1440/1024/412,
// and an axe pass scoped to the migrated table.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock';

async function openResults(page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: /Past Sequences/i }).click();
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
    await expect(page.getByText('Delivered').first()).toBeVisible();
    await expect(page.getByText('Failed').first()).toBeVisible();
    await expect(page.getByText('Carrier rejected the message.').first()).toBeVisible();
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

  test('uses a mobile layout without document-level horizontal overflow', async ({ page }, testInfo) => {
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
});
