// Real-browser verification for the shared `ConfirmDialog` that replaced the last
// blocking `window.confirm` / `confirm()` guards (2026-07-28).
//
// The driver application's "remove an uploaded document" confirmation is the one
// of those flows that is reachable end-to-end without a backend, so it is the one
// driven here — and it is also the highest-risk one, because the public
// application is the most mobile-heavy surface in the product and a native prompt
// there cannot be styled, announced or reliably dismissed.
//
// The operator-side confirmations (campaign cancel/delete, retry, template delete,
// envelope void) need seeded Firestore data that is not reachable under
// `VITE_E2E_TEST_MODE=1`; those are covered by their focused unit suites, which can
// supply data deterministically. What is verified here is the *dialog contract*
// itself, which all six share through one component.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const {
  fillStep1,
  fillStep2,
  fillStep3RequiredFields,
  uploadStandardDocuments,
} = require('./helpers/wizardHelpers.cjs');

/** Drives the wizard to the document step with three files uploaded. */
async function reachUploadedDocuments(page) {
  await page.goto('/apply/e2e-company');
  await expect(page.locator('#step-title')).toHaveText('Step 1 of 9: Personal Information');
  await fillStep1(page, 'full');
  await fillStep2(page);
  await fillStep3RequiredFields(page);
  await uploadStandardDocuments(page);
  await expect(page.getByText('Uploaded Successfully')).toHaveCount(3);
}

const removeButton = (page) => page.getByRole('button', { name: /^Remove .* file$/ }).first();

async function expectNoHorizontalOverflow(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe('ConfirmDialog — real browser', () => {
  test.describe.configure({ timeout: 120_000 });

  test('no native dialog is used, and nothing is removed until confirmed', async ({ page }) => {
    let nativeDialogs = 0;
    page.on('dialog', async (d) => { nativeDialogs += 1; await d.dismiss(); });

    await reachUploadedDocuments(page);
    await removeButton(page).click();

    const dialog = page.getByRole('dialog', { name: 'Remove this file?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Still three uploads: opening the dialog removed nothing.
    await expect(page.getByText('Uploaded Successfully')).toHaveCount(3);
    expect(nativeDialogs, 'a blocking browser dialog was used').toBe(0);
  });

  test('opens with focus on the safe action and contains focus', async ({ page }) => {
    await reachUploadedDocuments(page);
    await removeButton(page).click();

    const dialog = page.getByRole('dialog', { name: 'Remove this file?' });
    // Focus starts on the non-destructive action.
    await expect(dialog.getByRole('button', { name: 'Keep file' })).toBeFocused();

    // Tab cycles inside the dialog; it never escapes to the page behind.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
  });

  test('Escape dismisses without removing and restores focus to the trigger', async ({ page }) => {
    await reachUploadedDocuments(page);
    const trigger = removeButton(page);
    await trigger.focus();
    await trigger.click();

    await expect(page.getByRole('dialog', { name: 'Remove this file?' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: 'Remove this file?' })).toHaveCount(0);
    await expect(page.getByText('Uploaded Successfully')).toHaveCount(3);
    await expect(trigger).toBeFocused();
  });

  test('Cancel dismisses without removing', async ({ page }) => {
    await reachUploadedDocuments(page);
    await removeButton(page).click();

    const dialog = page.getByRole('dialog', { name: 'Remove this file?' });
    await dialog.getByRole('button', { name: 'Keep file' }).click();

    await expect(page.getByRole('dialog', { name: 'Remove this file?' })).toHaveCount(0);
    await expect(page.getByText('Uploaded Successfully')).toHaveCount(3);
  });

  test('a backdrop click does not confirm a destructive action', async ({ page }) => {
    await reachUploadedDocuments(page);
    await removeButton(page).click();

    const dialog = page.getByRole('dialog', { name: 'Remove this file?' });
    await expect(dialog).toBeVisible();

    // Click the overlay well away from the panel.
    await page.mouse.click(4, 4);

    await expect(page.getByText('Uploaded Successfully')).toHaveCount(3);
  });

  test('confirming removes exactly the chosen file', async ({ page }) => {
    await reachUploadedDocuments(page);
    await removeButton(page).click();

    const dialog = page.getByRole('dialog', { name: 'Remove this file?' });
    await dialog.getByRole('button', { name: 'Remove file' }).click();

    await expect(page.getByRole('dialog', { name: 'Remove this file?' })).toHaveCount(0);
    // Exactly one of the three uploads is gone.
    await expect(page.getByText('Uploaded Successfully')).toHaveCount(2);
  });

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await reachUploadedDocuments(page);
    await removeButton(page).click();
    await expect(page.getByRole('dialog', { name: 'Remove this file?' })).toBeVisible();

    const { violations } = await new AxeBuilder({ page }).analyze();
    const severe = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}]`);
    expect(severe, 'ConfirmDialog axe').toEqual([]);
  });

  for (const { label, width, height } of [
    { label: '1440', width: 1440, height: 900 },
    { label: '1024', width: 1024, height: 768 },
    { label: '412', width: 412, height: 915 },
  ]) {
    test(`fits ${label} px with no document overflow`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith('mobile'), 'Explicit viewport sweep runs on the desktop lane.');
      await page.setViewportSize({ width, height });
      await reachUploadedDocuments(page);
      await removeButton(page).click();
      await expect(page.getByRole('dialog', { name: 'Remove this file?' })).toBeVisible();
      await expectNoHorizontalOverflow(page, `${label} ConfirmDialog`);
    });
  }

  test('stays usable and non-overflowing on a mobile device lane', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile device lane.');
    await reachUploadedDocuments(page);
    await removeButton(page).click();

    const dialog = page.getByRole('dialog', { name: 'Remove this file?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Remove file' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep file' })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'mobile ConfirmDialog');
  });
});
