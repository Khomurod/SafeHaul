/**
 * A Company Admin's edits, as the driver sees them.
 *
 * Once the driver's page takes the carrier's edits (`companyEditsSync.js`), a
 * notice above every step names the sections they changed until the driver
 * dismisses it. The answers and the notice travel in the local draft, so this
 * seeds one that has taken edits and opens the page on it. What is sent to the
 * server is pinned too: neither key the edits leave beside the answers is ever
 * sent as one.
 */
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const REVISION = 1791300000000;

/** A local draft at the Review step that has taken a carrier's edits to two sections. */
const seedEditedDraft = (page) => page.addInitScript((revision) => {
  localStorage.setItem('draft_e2e-company', JSON.stringify({
    v: 1,
    lastStep: 7,
    meta: { localSeq: 3, syncedSeq: 3, savedAt: '2026-10-06T10:00:00.000Z', draftId: 'e2e-draft' },
    data: {
      firstName: 'Ada',
      lastName: 'Driver',
      email: 'ada@example.com',
      phone: '5555551234',
      city: 'Dallas',
      _companyRevision: revision,
      _companyNotice: ['city', 'employers'],
    },
  }));
}, REVISION);

const carrierNotice = (page) => page.getByRole('status').filter({ hasText: 'Your carrier updated your application' });

test.describe('a carrier\'s edits on the driver\'s page', () => {
  test.describe.configure({ timeout: 60_000 });

  test('are named above the step until the driver dismisses them', async ({ page }) => {
    await seedEditedDraft(page);
    await page.goto('/apply/e2e-company');

    await expect(page.locator('#step-title')).toContainText('Review', { timeout: 30_000 });
    await expect(carrierNotice(page)).toContainText(
      'They changed: Address History, Employment History. Check these answers before you sign.',
    );

    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(carrierNotice(page)).toHaveCount(0);
  });

  test('never leave the browser as answers', async ({ page }) => {
    await seedEditedDraft(page);
    await page.goto('/apply/e2e-company');
    await expect(page.locator('#step-title')).toContainText('Review', { timeout: 30_000 });

    // Moving on sends the copy to the server.
    await page.getByRole('button', { name: /Confirm & Proceed/ }).click();
    await expect(page.locator('#step-title')).toContainText('Agreements', { timeout: 30_000 });
    await expect.poll(async () => page.evaluate(() => (window.__e2eDraftSaves || []).length)).toBeGreaterThan(0);

    const saves = await page.evaluate(() => window.__e2eDraftSaves);
    for (const save of saves) {
      expect(save.formData).not.toHaveProperty('_companyRevision');
      expect(save.formData).not.toHaveProperty('_companyNotice');
      expect(save.formData.city).toBe('Dallas');
    }
  });

  test('pass axe with the notice showing @a11y', async ({ page }) => {
    await seedEditedDraft(page);
    await page.goto('/apply/e2e-company');
    await expect(carrierNotice(page)).toBeVisible({ timeout: 30_000 });

    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(serious, JSON.stringify(serious.map((violation) => violation.id))).toEqual([]);
  });
});
