const { expect } = require('@playwright/test');

/**
 * Shared driver-application wizard helpers.
 *
 * DETERMINISM CONTRACT (2026-07-27) — read before editing.
 *
 * Every step transition and every asynchronous side effect is waited for by
 * *state*, never by a sleep and never by leaning on Playwright's per-action
 * auto-wait to paper over a missing barrier. Two concrete flakes were traced to
 * violations of that rule:
 *
 * 1. `setInputFiles` × 3 followed immediately by clicking Continue. The three
 *    guest uploads are independent async writes, and `isUploading` briefly drops
 *    to false between them — so the "Continue" label reappears, Playwright clicks
 *    it, and `Step3_License.handleContinue` runs while the third upload has not
 *    yet reached `formData`. It sets "Please upload required documents: Medical
 *    Card." and refuses to advance. The arriving upload then *clears* that
 *    message, leaving a page that looks completely valid but is still on step 3.
 *    The run then times out on `label[for="consent-mvr-yes"]` — the reported
 *    symptom, three steps away from the cause. Fixed by
 *    `waitForUploads()`, which waits for each field's own committed
 *    `data-upload-state="uploaded"`.
 *
 * 2. Chained `Continue` clicks with no assertion between them. React commits the
 *    step change asynchronously, so the *same* still-mounted button can be
 *    clicked twice and one step is silently skipped. Fixed by `continueToStep()`,
 *    which asserts the new `#step-title` after every advance.
 *
 * Neither fix hides an application defect: the missing-upload message is now a
 * focused `role="alert"`, and the wizard now moves focus to each new step's
 * heading instead of running two competing scroll animations.
 */

const pdfFile = (name) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8'),
});

/** Wait until the wizard is actually showing the expected step. */
async function expectStep(page, titleFragment) {
  await expect(page.locator('#step-title')).toContainText(titleFragment, { timeout: 30_000 });
}

/** Click Continue and wait for the step to actually change. */
async function continueToStep(page, nextTitleFragment) {
  await page.getByRole('button', { name: 'Continue' }).click();
  await expectStep(page, nextTitleFragment);
}

/**
 * Click a radio's label and confirm the input really took the value. Guards
 * against a click landing during a re-render.
 */
async function chooseRadio(page, id) {
  await page.locator(`label[for="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toBeChecked();
}

/**
 * Wait for each named upload field to report its own committed state.
 * `data-upload-state` is a deliberate test contract on `UploadField`.
 */
async function waitForUploads(page, names) {
  for (const name of names) {
    await expect(
      page.locator(`[data-upload-field="${name}"]`),
    ).toHaveAttribute('data-upload-state', 'uploaded', { timeout: 30_000 });
  }
}

/** Attach the three standard guest documents and wait until all three land. */
async function uploadStandardDocuments(page) {
  await page.setInputFiles('input[name="cdl-front"]', pdfFile('cdl-front.pdf'));
  await page.setInputFiles('input[name="cdl-back"]', pdfFile('cdl-back.pdf'));
  await page.setInputFiles('input[name="medical-card-upload"]', pdfFile('med-card.pdf'));
  await waitForUploads(page, ['cdl-front', 'cdl-back', 'medical-card-upload']);
}

async function fillDateTriplet(page, prefix, { month, day, year }) {
  await page.locator(`#${prefix}-year`).waitFor({ state: 'visible', timeout: 15_000 });
  await page.selectOption(`#${prefix}-year`, String(year));
  await page.selectOption(`#${prefix}-month`, String(month));
  await page.selectOption(`#${prefix}-day`, String(day));
  await expect(page.locator(`#${prefix}-year`)).toHaveValue(String(year));
  await expect(page.locator(`#${prefix}-month`)).toHaveValue(String(month));
  await expect(page.locator(`#${prefix}-day`)).toHaveValue(String(day));
}

async function fillStep1(page, suffix = '') {
  await expectStep(page, 'Personal Information');
  await page.fill('#first-name', `Test${suffix}`);
  await page.fill('#last-name', 'Driver');
  await page.fill('#ssn', '123-45-6789');
  await fillDateTriplet(page, 'dob', { month: 1, day: 1, year: 1990 });
  await page.fill('#phone', '5555551234');
  await page.fill('#email', `test${suffix || 'guest'}@example.com`);
  await page.fill('#street', '123 Main St');
  await page.fill('#city', 'Austin');
  await page.selectOption('#state', 'Texas');
  await page.fill('#zip', '78701');
  await chooseRadio(page, 'sms-consent-yes');
  await chooseRadio(page, 'residence-3-years-yes');
  await continueToStep(page, 'Qualification');
}

async function fillStep2(page) {
  await page.locator('label[for="legal-work-yes"]').waitFor({ state: 'visible', timeout: 15_000 });
  await chooseRadio(page, 'legal-work-yes');
  await chooseRadio(page, 'english-fluency-yes');
  await chooseRadio(page, 'drug-test-positive-no');
  await chooseRadio(page, 'dot-return-to-duty-yes');
  await chooseRadio(page, 'experience-years-1');
  await continueToStep(page, 'License');
}

async function fillStep3RequiredFields(page) {
  await page.locator('#cdl-state').waitFor({ state: 'visible', timeout: 15_000 });
  await page.selectOption('#cdl-state', 'Texas');
  await page.getByLabel('Class A').click();
  await expect(page.getByLabel('Class A')).toBeChecked();
  await page.fill('#cdl-number', 'TX1234567');
  await fillDateTriplet(page, 'cdl-expiration', { month: 12, day: 31, year: 2030 });
  await chooseRadio(page, 'has-other-licenses-no');
  await chooseRadio(page, 'has-twic-no');
}

/**
 * Steps 4 → 8. Every advance asserts the new step before the next interaction,
 * so a lost or doubled click fails where it happens instead of three steps later.
 */
async function completeRemainingSteps(page) {
  await expectStep(page, 'Motor Vehicle Record');
  await chooseRadio(page, 'consent-mvr-yes');
  await chooseRadio(page, 'revoked-licenses-no');
  await chooseRadio(page, 'driving-convictions-no');
  await chooseRadio(page, 'drug-alcohol-convictions-no');
  await continueToStep(page, 'Accident History');

  await continueToStep(page, 'Employment History');
  await continueToStep(page, 'General Questions');

  await chooseRadio(page, 'has-felony-no');
  await continueToStep(page, 'Review Information');

  await page.getByRole('button', { name: 'Confirm & Proceed' }).click();
  await expectStep(page, 'Agreements & Signature');
}

async function applySignature(page) {
  for (const id of ['agree-electronic', 'agree-background-check']) {
    const box = page.locator(`#${id}`);
    if ((await box.count()) > 0) {
      await box.check();
      await expect(box).toBeChecked();
    }
  }
  await page.getByRole('button', { name: 'Use Test Signature' }).click();
  await expect(page.getByText('Signature Saved & Locked')).toBeVisible();
}

async function submitApplication(page) {
  await page.check('#final-certification');
  await expect(page.locator('#final-certification')).toBeChecked();
  const submit = page.getByRole('button', { name: 'Submit Full Application' });
  await expect(submit).toBeEnabled();
  await submit.click();
}

module.exports = {
  pdfFile,
  expectStep,
  continueToStep,
  chooseRadio,
  waitForUploads,
  uploadStandardDocuments,
  fillDateTriplet,
  fillStep1,
  fillStep2,
  fillStep3RequiredFields,
  completeRemainingSteps,
  applySignature,
  submitApplication,
};
