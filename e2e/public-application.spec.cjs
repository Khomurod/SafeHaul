const { test, expect } = require('@playwright/test');
const {
  pdfFile,
  fillStep1,
  fillStep2,
  fillStep3RequiredFields,
  uploadStandardDocuments,
  continueToStep,
  expectStep,
  chooseRadio,
  fillDateTriplet,
  completeStepsToReview,
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

  test('after Edit on Review, Continue returns straight to Review', async ({ page }) => {
    await page.goto('/apply/e2e-company');
    await fillStep1(page, 'review');
    await fillStep2(page);
    await fillStep3RequiredFields(page);
    await uploadStandardDocuments(page);
    await continueToStep(page, 'Motor Vehicle Record');
    await completeStepsToReview(page);

    // The first section is page one. Continue there skips the six pages after it.
    await page.getByRole('button', { name: /^Edit / }).first().click();
    await expectStep(page, 'Personal Information');
    await continueToStep(page, 'Review Information');

    // Only that once: from Review onwards the wizard moves one page at a time again.
    await page.getByRole('button', { name: 'Confirm & Proceed' }).click();
    await expectStep(page, 'Agreements & Signature');
  });

  test('an employer of the past three years needs the reason for leaving and the two DOT answers', async ({ page }) => {
    await page.goto('/apply/e2e-company');
    await fillStep1(page, 'employer');
    await fillStep2(page);
    await fillStep3RequiredFields(page);
    await uploadStandardDocuments(page);
    await continueToStep(page, 'Motor Vehicle Record');
    await chooseRadio(page, 'consent-mvr-yes');
    await chooseRadio(page, 'revoked-licenses-no');
    await chooseRadio(page, 'driving-convictions-no');
    await chooseRadio(page, 'drug-alcohol-convictions-no');
    await chooseRadio(page, 'has-violations-no');
    await continueToStep(page, 'Accident History');
    await chooseRadio(page, 'has-accidents-no');
    await continueToStep(page, 'Employment History');

    // One job from four years ago until today, so the three years are covered.
    const today = new Date();
    await page.getByRole('button', { name: '+ Add Employer' }).click();
    await page.fill('#emp-name-0', 'Artificial Freight Co');
    await page.fill('#emp-street-0', '1 Test Way');
    await page.fill('#emp-city-0', 'Springfield');
    await page.selectOption('#emp-state-0', 'Texas');
    await page.fill('#emp-phone-0', '5555550100');
    await fillDateTriplet(page, 'emp-start-0', { month: 1, day: 1, year: today.getFullYear() - 4 });
    await fillDateTriplet(page, 'emp-end-0', { month: today.getMonth() + 1, day: today.getDate(), year: today.getFullYear() });

    // Unanswered, the page does not move on, and nothing was chosen for the driver.
    await expect(page.locator('#emp-fmcsrs-0-yes')).not.toBeChecked();
    await expect(page.locator('#emp-fmcsrs-0-no')).not.toBeChecked();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expectStep(page, 'Employment History');
    await expect(page.locator('#emp-reason-0:invalid')).toHaveCount(1);

    await page.fill('#emp-reason-0', 'Better route');
    await chooseRadio(page, 'emp-fmcsrs-0-yes');
    await chooseRadio(page, 'emp-dot-tested-0-no');
    await continueToStep(page, 'General Questions');
    await chooseRadio(page, 'has-felony-no');
    await continueToStep(page, 'Review Information');

    const answer = (label) => page.locator('.ds-field-display').filter({
      has: page.locator('.ds-field-display__label', { hasText: label }),
    });
    await expect(answer('Reason for Leaving')).toContainText('Better route');
    await expect(answer('Subject to FMCSRs')).toContainText('Yes');
    await expect(answer('Safety-Sensitive (DOT Drug & Alcohol Testing)')).toContainText('No');
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
