// E2E coverage for the EnvelopeHistory design-system migration (Documents
// Center → history table). The e2eEdoc=mock harness stubs templates only; it
// does not seed `signing_requests`, and seeding it would require changing
// DocumentsManager, which is out of scope for this slice. So the browser-level
// assertions cover the DataTable shell that renders regardless of data: the
// labelled keyboard-reachable scroll region, the column contract, the
// announced loading/empty/error state, responsive overflow at 1440/1024/412
// and a scoped real-browser axe pass.
//
// Row rendering, status/delivery badges, the void / copy-link / correct /
// download actions and their error paths are covered by the vitest suite in
// src/features/signing/components/EnvelopeHistory.test.jsx, which uses
// artificial recipients and reserved example domains only. No real recipient
// data or signing link is ever loaded here.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock';

async function openHistory(page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible({ timeout: 20_000 });
  // The workspace opens on Overview; the history table lives in Sent Documents.
  await page.getByRole('tab', { name: /^Sent Documents/ }).click();
  await expect(page.getByRole('region', { name: /^Document history\./ })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('E-Doc envelope history slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes the history table through a labelled, keyboard-reachable region', async ({ page }) => {
    await openHistory(page);

    const region = page.getByRole('region', { name: /^Document history\./ });
    // The horizontally scrollable area must be focusable so keyboard-only users
    // can reach off-screen columns (axe: scrollable-region-focusable).
    await expect(region).toHaveAttribute('tabindex', '0');
    await region.focus();
    await expect(region).toBeFocused();
  });

  test('keeps the column contract intact', async ({ page }) => {
    await openHistory(page);

    const headers = page.getByRole('columnheader');
    await expect(headers).toHaveText([
      'Document Title',
      'Recipient',
      'Status',
      'Sent Date',
      'Actions',
    ]);
  });

  test('announces its data state through a live region, never a silent empty table', async ({ page }) => {
    await openHistory(page);

    // Which state the harness lands in is environment-dependent — the snapshot
    // may still be pending, may resolve with no documents, or may be rejected —
    // so the invariant under test is that whichever one it is gets announced,
    // rather than a bare table with no rows and no explanation.
    const liveRegion = page.locator('.ds-data-table [role="status"], .ds-data-table [role="alert"]');
    await expect(liveRegion.first()).toBeVisible();
    await expect(liveRegion.first()).toHaveText(
      /Loading document history|No documents sent yet\.|Could not load document history/,
    );
  });

  test('does not overflow the document at desktop/tablet/mobile', async ({ page }, testInfo) => {
    const widths = testInfo.project.name.startsWith('mobile') ? [412] : [1440, 1024];
    await page.setViewportSize({ width: widths[0], height: widths[0] === 412 ? 915 : 900 });
    await openHistory(page);

    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 412 ? 915 : 900 });
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    }
  });

  test('has no serious/critical or contrast violations in the history table', async ({ page }) => {
    await openHistory(page);

    const { violations } = await new AxeBuilder({ page }).include('.ds-data-table').analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });
});
