// E2E coverage for the EnvelopeHistory design-system migration (Documents
// Center → history table). These run on the plain e2eEdoc=mock harness, which
// seeds no `signing_requests`, so they cover the DataTable shell that renders
// regardless of data (the list with made-up documents, `e2eEdocSent=mock`, is
// covered by the workspace spec, the table-layout guard and the screenshots): the
// labelled keyboard-reachable scroll region, the column contract, the
// announced loading/empty/error state, responsive overflow at 1440/1024/412
// and a scoped real-browser axe pass. One test uses `e2eEdocSent=signedCopy`
// for the approved signed copy, answering its callable here.
//
// Row rendering, status/delivery badges, the void / copy-link / correct /
// download actions and their error paths are covered by the vitest suite in
// src/features/signing/components/EnvelopeHistory.test.jsx, which uses
// artificial recipients and reserved example domains only. No real recipient
// data or signing link is ever loaded here.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

async function openHistory(page, url = URL) {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: 'E-Docs' })).toBeVisible({ timeout: 20_000 });
  // The workspace opens on Overview; the history table lives in Sent Documents.
  // On a phone the rows are cards, and the region drops "Scroll horizontally".
  await page.getByRole('tab', { name: /^Sent Documents/ }).click();
  await expect(page.getByRole('region', { name: /^Document history/ })).toBeVisible({
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
      'Document',
      'Recipient',
      'Delivery',
      'Status',
      'Date sent',
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

  test('does not overflow the document at desktop/tablet/mobile @mobile', async ({ page }, testInfo) => {
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

  test('a signed document with a company signature is approved and its copy sent once', async ({ page }) => {
    // E2E mode has no Functions: the callable is answered here, and what it
    // receives is asserted. The rows are the made-up `e2eEdocSent=signedCopy` set.
    const sent = [];
    await page.route('**/sendSignedDocumentCopy', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      sent.push(route.request().postDataJSON()?.data);
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ result: { success: true, sentTo: 'rosa.delgado@example.test', sentAt: new Date().toISOString() } }),
      });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHistory(page, `${URL}&e2eEdocSent=signedCopy`);

    // What each row says about its copy.
    await expect(page.getByText(/^Copy sent to omar\.haddad@example\.test on /)).toBeVisible();
    await expect(page.getByText('Sending copy…')).toBeVisible();
    await expect(page.getByText('Copy not sent')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again: send signed copy of Escrow Agreement' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download Fuel Card Agreement' })).toBeVisible();
    // Without a company signature, a signed document is as it always was.
    await expect(page.getByRole('button', { name: 'Download Safety Handbook Receipt' })).toBeVisible();
    await expect(page.getByRole('button', { name: /signed copy of Safety Handbook Receipt/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Send signed copy of Independent Contractor Agreement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send the signed copy?' });
    await expect(dialog).toContainText('Independent Contractor Agreement');
    await expect(dialog).toContainText('rosa.delgado@example.test');
    await expect(dialog).toContainText('The driver gets the signed PDF, with your company signature, at this address. This is sent once.');
    await expect(dialog.getByRole('button', { name: 'View signed PDF' })).toBeVisible();
    expect(sent).toEqual([]);

    // A double click is still one send.
    await dialog.getByRole('button', { name: 'Approve and send' }).dblclick();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText('Signed copy sent to rosa.delgado@example.test')).toBeVisible();
    await expect(page.getByText(/^Copy sent to rosa\.delgado@example\.test on /)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send signed copy of Independent Contractor Agreement' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Download Independent Contractor Agreement' })).toBeVisible();
    expect(sent).toEqual([{ companyId: 'e2e-company', requestId: 'e2e-copy-ready', recipientEmail: 'rosa.delgado@example.test' }]);
  });

  test('a document whose seal failed is sealed again from its details, once', async ({ page }) => {
    // E2E mode has no Functions: the callable is answered here, and what it
    // receives is asserted. The rows are the made-up `e2eEdocSent=mock` set.
    const asked = [];
    await page.route('**/retrySealDocument', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      asked.push(route.request().postDataJSON()?.data);
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ result: { success: true, status: 'pending_seal', attempt: 1 } }),
      });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHistory(page, `${URL}&e2eEdocSent=mock`);

    // The row keeps Review; the reason and Retry seal are in its details.
    await expect(page.getByRole('button', { name: /^Retry seal/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Review details for Lease Agreement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Lease Agreement' });
    await expect(dialog).toContainText('The signed pages could not be sealed.');

    await dialog.getByRole('button', { name: 'Retry seal' }).dblclick();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText('Sealing again. The status here changes when it finishes.')).toBeVisible();
    expect(asked).toEqual([{ companyId: 'e2e-company', requestId: 'e2e-req-lease' }]);
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
