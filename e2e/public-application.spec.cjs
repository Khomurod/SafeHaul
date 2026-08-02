const { test, expect } = require('@playwright/test');
const {
  pdfFile,
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
 * This spec used to carry its own private copies of the wizard helpers, which is
 * how the upload/step-transition determinism fixes landed in one place and not
 * the other. It now uses the shared, state-based helpers — see the determinism
 * contract at the top of `helpers/wizardHelpers.cjs`.
 */
test.describe('guest public application', () => {
  test.describe.configure({ timeout: 90_000 });

  test('guest applicant can complete full submission with CDL and med card uploads', async ({ page }) => {
    await page.goto('/apply/e2e-company');
    await expect(page.locator('#step-title')).toHaveText('Step 1 of 9: Personal Information');

    await fillStep1(page, 'full');
    await fillStep2(page);
    await fillStep3RequiredFields(page);
    await uploadStandardDocuments(page);

    // Every upload card reports success before the step advances.
    await expect(page.getByText('Uploaded Successfully')).toHaveCount(3);

    await continueToStep(page, 'Motor Vehicle Record');
    await completeRemainingSteps(page);
    await applySignature(page);
    await submitApplication(page);

    await expect(page.getByText('Application Submitted!')).toBeVisible();
    await expect(page.getByText('Confirmation Number')).toBeVisible();
  });

  test('guest upload shows permission error when upload guard denies access', async ({ page }) => {
    await page.goto('/apply/e2e-company?e2eUpload=deny');
    await expect(page.locator('#step-title')).toHaveText('Step 1 of 9: Personal Information');

    await fillStep1(page, 'deny');
    await fillStep2(page);
    await fillStep3RequiredFields(page);

    await page.setInputFiles('input[name="cdl-front"]', pdfFile('blocked-cdl-front.pdf'));

    // The field reports its own failure state, and both the field-level and
    // toast messages are announced.
    await expect(page.locator('[data-upload-field="cdl-front"]'))
      .toHaveAttribute('data-upload-state', 'error');
    await expect(page.getByText('E2E upload blocked by mock permission guard.')).toBeVisible();
    await expect(page.getByRole('alert').getByText('Upload failed. Please try again.')).toBeVisible();
  });

  test('pressing Continue with a required document missing announces why and stays put', async ({ page }) => {
    await page.goto('/apply/e2e-company');
    await fillStep1(page, 'missingdoc');
    await fillStep2(page);
    await fillStep3RequiredFields(page);

    await page.getByRole('button', { name: 'Continue' }).click();

    // Previously a silent `<div>`: nothing was announced and nothing was focused,
    // so the applicant had no idea why Continue did nothing.
    const alert = page.getByRole('alert').filter({ hasText: 'Please upload required documents' });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await expect(page.locator('#step-title')).toContainText('License');
  });

  test('the wizard moves focus to each new step heading', async ({ page }) => {
    await page.goto('/apply/e2e-company');
    await fillStep1(page, 'focus');

    // Focus follows the step change instead of being dropped on <body> when the
    // Continue button unmounts.
    await expect(page.locator('#step-title')).toBeFocused();
    await expect(page.locator('#step-title')).toContainText('Qualification');
  });

  test('progress is exposed to assistive technology, not only as a bar width', async ({ page }) => {
    await page.goto('/apply/e2e-company');
    const bar = page.locator('#progress-bar');
    await expect(bar).toHaveAttribute('role', 'progressbar');
    await expect(bar).toHaveAttribute('aria-valuenow', '1');
    await expect(bar).toHaveAttribute('aria-valuemax', '9');

    await fillStep1(page, 'progress');
    await expect(bar).toHaveAttribute('aria-valuenow', '2');
  });
});
