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

test.describe('guest application intake chooser', () => {
  test.describe.configure({ timeout: 90_000 });

  test('manual intake path completes full wizard', async ({ page }) => {
    await page.goto('/apply/e2e-company?e2eIntake=choice');
    await expect(page.getByText('Fill Out Manually')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Fill Out Manually').click();

    await expect(page.locator('#step-title')).toHaveText('Step 1 of 9: Personal Information');
    await fillStep1(page, 'manual');
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
  });

  test('back navigation preserves step 1 fields', async ({ page }) => {
    await page.goto('/apply/e2e-company?e2eIntake=choice');
    await page.getByText('Fill Out Manually').click();
    await fillStep1(page, 'back');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('#first-name')).toHaveValue('Testback');
    await expect(page.locator('#last-name')).toHaveValue('Driver');
  });
});
