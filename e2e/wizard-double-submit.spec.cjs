const { test, expect } = require('@playwright/test');
const {
  fillStep1,
  fillStep2,
  fillStep3RequiredFields,
  uploadStandardDocuments,
  continueToStep,
  completeRemainingSteps,
  applySignature,
} = require('./helpers/wizardHelpers.cjs');

test.describe('guest application submit guard', () => {
  test.describe.configure({ timeout: 90_000 });

  test('disables submit after first click in e2e mode', async ({ page }) => {
    await page.goto('/apply/e2e-company');
    await fillStep1(page, 'dbl');
    await fillStep2(page);
    await fillStep3RequiredFields(page);
    // State-based: wait for all three uploads to commit before advancing.
    // Clicking Continue mid-upload silently blocked the step (see the
    // determinism contract in helpers/wizardHelpers.cjs).
    await uploadStandardDocuments(page);
    await continueToStep(page, 'Motor Vehicle Record');
    await completeRemainingSteps(page);
    await applySignature(page);
    await page.check('#final-certification');

    const submitBtn = page.getByRole('button', { name: /Submit Full Application/i });
    await submitBtn.click({ clickCount: 3, delay: 50 });
    await expect(page.getByText('Application Submitted!')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Application Submitted!')).toHaveCount(1);
  });
});
