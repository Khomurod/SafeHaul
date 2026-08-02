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

/**
 * Full post-application Required Documents journey:
 * submit application -> required checklist -> sign doc 1 -> return ->
 * checklist updated -> sign doc 2 -> return -> all required complete.
 * The optional form stays available but never blocks completion.
 */
test.describe('guest post-application Required Documents', () => {
  test.describe.configure({ timeout: 120_000 });

  const REQUIRED_1 = 'e2e-post-template';
  const REQUIRED_2 = 'e2e-post-template-2';
  const OPTIONAL = 'e2e-post-template-optional';

  async function submitFullApplication(page, suffix) {
    await page.goto('/apply/e2e-company');
    await fillStep1(page, suffix);
    await fillStep2(page);
    await fillStep3RequiredFields(page);
    // State-based: wait for all three uploads to commit before advancing.
    // Clicking Continue mid-upload silently blocked the step (see the
    // determinism contract in helpers/wizardHelpers.cjs).
    await uploadStandardDocuments(page);
    await continueToStep(page, 'Motor Vehicle Record');
    await completeRemainingSteps(page);
    await applySignature(page);
    await submitApplication(page);
    await expect(page.getByText('Application Submitted!')).toBeVisible();
  }

  async function signCurrentDocumentAndReturn(page) {
    await expect(page.getByText('E2E Test Document')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /I Agree - Proceed to Sign/i }).click();
    await page.getByRole('button', { name: /Finish & Submit/i }).click();
    await expect(page.getByText('Document Signed!')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Return to Required Documents/i }).click();
    await expect(page.getByText('Application Submitted!')).toBeVisible({ timeout: 15_000 });
  }

  test('required checklist tracks documents one by one until every required form is complete', async ({ page }) => {
    await submitFullApplication(page, 'reqdocs');

    // The checklist presents REQUIRED documents (not "optional onboarding forms").
    const requiredSection = page.getByTestId('required-documents-section');
    await expect(requiredSection).toBeVisible();
    await expect(requiredSection.getByText('Required Documents')).toBeVisible();
    await expect(requiredSection.getByText(/still need to be completed/i)).toBeVisible();
    await expect(page.getByTestId('required-documents-progress')).toHaveText('0 of 2 completed');

    // Both required docs start as Not started; the optional form sits apart.
    await expect(page.getByTestId(`post-apply-doc-${REQUIRED_1}`).getByText('Not started')).toBeVisible();
    await expect(page.getByTestId(`post-apply-doc-${REQUIRED_2}`).getByText('Not started')).toBeVisible();
    await expect(page.getByText('Optional forms')).toBeVisible();
    await expect(page.getByTestId(`post-apply-doc-${OPTIONAL}`)).toBeVisible();

    // Document 1: open -> deterministic per-template signing request -> sign -> return.
    await page.getByTestId(`post-apply-doc-${REQUIRED_1}`).getByRole('button').first().click();
    await expect(page).toHaveURL(new RegExp(`/sign/e2e-company/e2e-post-app-req-${REQUIRED_1}\\?token=`));
    await signCurrentDocumentAndReturn(page);

    // Checklist survived the round trip and shows document 1 as completed.
    await expect(page.getByTestId(`post-apply-doc-${REQUIRED_1}`).getByText('Completed')).toBeVisible();
    await expect(page.getByTestId('required-documents-progress')).toHaveText('1 of 2 completed');
    // A completed document cannot be reopened (no duplicate requests).
    await expect(
      page.getByTestId(`post-apply-doc-${REQUIRED_1}`).getByRole('button').first()
    ).toBeDisabled();
    // Overall process not "complete" while a required document is pending.
    await expect(page.getByText(/please complete the required documents below/i)).toBeVisible();

    // Document 2: complete the remaining required form.
    await page.getByTestId(`post-apply-doc-${REQUIRED_2}`).getByRole('button').first().click();
    await expect(page).toHaveURL(new RegExp(`/sign/e2e-company/e2e-post-app-req-${REQUIRED_2}\\?token=`));
    await signCurrentDocumentAndReturn(page);

    await expect(page.getByTestId('required-documents-progress')).toHaveText('2 of 2 completed');
    await expect(page.getByText(/All required documents are completed/i)).toBeVisible();
    await expect(page.getByText(/a recruiter will contact you soon/i)).toBeVisible();
  });

  test('checklist is restored when the driver reloads the apply page mid-flow', async ({ page }) => {
    await submitFullApplication(page, 'reload');
    await expect(page.getByTestId('required-documents-progress')).toHaveText('0 of 2 completed');

    // Simulate the driver reloading (same tab/session) — the submission and
    // checklist must come back instead of a blank new application.
    await page.reload();
    await expect(page.getByText('Application Submitted!')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('required-documents-section')).toBeVisible();
    await expect(page.getByTestId('required-documents-progress')).toHaveText('0 of 2 completed');

    // "Start a new application" clears the restored session back to the wizard.
    await page.getByRole('button', { name: /Start a new application/i }).click();
    await expect(page.locator('#first-name')).toBeVisible({ timeout: 15_000 });
  });
});
