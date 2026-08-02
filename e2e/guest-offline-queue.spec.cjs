const { test, expect } = require('@playwright/test');
const {
  fillStep1,
  fillStep2,
  fillStep3RequiredFields,
  uploadStandardDocuments,
  continueToStep,
  completeRemainingSteps,
  applySignature,
  submitApplication,
} = require('./helpers/wizardHelpers.cjs');

test.describe('guest offline queue submit', () => {
  test.describe.configure({ timeout: 90_000 });

  test('shows queued message when forced queue mode on final submit', async ({ page, context }) => {
    await page.goto('/apply/e2e-company?e2eForceQueue=1');
    await expect(page.locator('#step-title')).toHaveText('Step 1 of 9: Personal Information', {
      timeout: 30_000,
    });

    await fillStep1(page, 'queue');
    await fillStep2(page);
    await fillStep3RequiredFields(page);
    // State-based: wait for all three uploads to commit before advancing.
    // Clicking Continue mid-upload silently blocked the step (see the
    // determinism contract in helpers/wizardHelpers.cjs).
    await uploadStandardDocuments(page);
    await continueToStep(page, 'Motor Vehicle Record');
    await completeRemainingSteps(page);
    await applySignature(page);

    await context.setOffline(true);
    await submitApplication(page);

    // The queued screen's heading is the persistent state; a transient toast
    // ("Application saved! It will be submitted automatically…") also appears,
    // so the assertion must target the heading specifically (strict mode).
    await expect(
      page.getByRole('heading', { name: 'Application Saved', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('will be automatically submitted when your connection is restored', { exact: false }),
    ).toBeVisible();

    // Verify the submission really landed in the IndexedDB queue — exactly one
    // pending guest entry for this company (no data loss, no duplicates).
    const queued = await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('SafeHaulSubmissionQueue');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['pending_submissions'], 'readonly');
        const req = tx.objectStore('pending_submissions').getAll();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result.map((entry) => ({
          status: entry.status,
          type: entry.type,
          companyId: entry.companyId,
          hasFormData: !!(entry.data && entry.data.firstName),
        })));
      };
    }));
    expect(queued).toHaveLength(1);
    expect(queued[0]).toEqual({
      status: 'pending',
      type: 'guest',
      companyId: 'e2e-company',
      hasFormData: true,
    });
  });
});
