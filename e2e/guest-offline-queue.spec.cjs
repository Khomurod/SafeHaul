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

/** Fills the application and submits it offline, onto the queued screen. */
async function queueAnApplication(page, context) {
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
  // saying the same also appears, so the assertion targets the heading
  // specifically (strict mode). It says the page must stay open, because the
  // queue sends only from this device.
  await expect(
    page.getByRole('heading', { name: 'Not sent yet', exact: true }),
  ).toBeVisible({ timeout: 15_000 });
}

/** Every entry in the IndexedDB queue, as the page sees it. */
function readQueue(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('SafeHaulSubmissionQueue');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['pending_submissions'], 'readonly');
      const req = tx.objectStore('pending_submissions').getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result.map((entry) => ({
        id: entry.id,
        applyDraftId: entry.applyDraftId,
        status: entry.status,
        type: entry.type,
        companyId: entry.companyId,
        hasFormData: !!(entry.data && entry.data.firstName),
      })));
    };
  }));
}

test.describe('guest offline queue submit', () => {
  test.describe.configure({ timeout: 90_000 });

  test('shows queued message when forced queue mode on final submit', async ({ page, context }) => {
    await queueAnApplication(page, context);
    await expect(
      page.getByText('will be sent as soon as the connection is back. Keep this page open', { exact: false }),
    ).toBeVisible();

    // Verify the submission really landed in the IndexedDB queue — exactly one
    // pending guest entry for this company (no data loss, no duplicates).
    const queued = await readQueue(page);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      status: 'pending',
      type: 'guest',
      companyId: 'e2e-company',
      hasFormData: true,
    });
  });

  test('shows the confirmation number when another tab of the site sent it', async ({ page, context }) => {
    // The queue runs in whichever tab of the site is open. Another one, opened
    // while there was still a connection, tells this tab through storage.
    const other = await context.newPage();
    await other.goto('/vite.svg');
    // A tab in the background has its timers slowed; the application's is the one in front.
    await page.bringToFront();
    await queueAnApplication(page, context);
    const [entry] = await readQueue(page);
    expect(entry.applyDraftId).toBeTruthy();

    await other.evaluate((detail) => {
      localStorage.setItem('safehaul:queued-application', JSON.stringify(detail));
      localStorage.removeItem('safehaul:queued-application');
    }, {
      slug: 'e2e-company',
      companyId: 'e2e-company',
      entryId: entry.id,
      applyDraftId: entry.applyDraftId,
      outcome: 'sent',
      applicationId: 'e2e-sent-elsewhere',
      confirmationNumber: 'SH-E2E-ELSEWHERE',
    });

    await expect(page.getByRole('heading', { name: 'Application Submitted!' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('SH-E2E-ELSEWHERE')).toBeVisible();
  });
});
