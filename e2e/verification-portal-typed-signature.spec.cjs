const { test, expect } = require('@playwright/test');
const {
  gotoForm,
  canvas,
  submitButton,
  errorSummary,
  inkCount,
  signWithMouse,
  fillRespondent,
  chooseInGroup,
  seriousViolations,
} = require('./helpers/verificationPortalHelpers.cjs');

/**
 * The Draw | Type signature choice on the public verification portal
 * (audit step J, 2026-09-06).
 *
 * A canvas has no keyboard path, so until this change a respondent who could
 * not use a mouse or a finger had no way to produce the legally operative mark
 * on a 49 CFR §391.23 response — and axe could not see it, because axe cannot
 * detect a missing input modality. `SignatureInput` now offers "Type": the name
 * is stored as `TEXT_SIGNATURE:<name>` with the method recorded, never drawn
 * into a PNG, so the record says which kind of mark it was.
 *
 * What only a real browser proves here:
 *  - the whole path works from the keyboard alone, toggle to submit;
 *  - switching method really clears the other mark — what the form will submit
 *    is always what the respondent can see, the same invariant the pad keeps on
 *    resize (`verification-portal-closeout.spec.cjs`);
 *  - the Type state has no serious axe violations of its own.
 *
 * Runs on Chromium and Mobile Chrome. No real tokens, drivers or employers.
 */

const signatureGroup = (page) => page.getByRole('group', { name: /Electronic Signature/ });
const typeToggle = (page) => signatureGroup(page).getByRole('button', { name: 'Type' });
const drawToggle = (page) => signatureGroup(page).getByRole('button', { name: 'Draw' });
const typedField = (page) => page.getByRole('textbox', { name: /Type your full name to sign/ });
const preview = (page) => page.getByTestId('typed-signature-preview');

test.describe('Verification portal typed signature', () => {
  test('signs by typing a name with the keyboard only, and submits', async ({ page }) => {
    // Everything after the radio choice is keyboard: focus the toggle, Enter,
    // type the name, Enter on the submit control.
    await gotoForm(page);
    await chooseInGroup(page, /Was this individual employed by your company/i, 'No / No Record Found');
    await fillRespondent(page);

    await typeToggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(typeToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas(page)).toHaveCount(0);

    await typedField(page).focus();
    await page.keyboard.type('Alex Employer');
    await expect(preview(page)).toHaveText('Alex Employer');

    await submitButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Verification Submitted Successfully/i)).toBeVisible({ timeout: 15_000 });
  });

  test('tells the respondent that typing the name is their legal signature', async ({ page }) => {
    await gotoForm(page);
    await typeToggle(page).click();
    const field = typedField(page);
    await expect(field).toHaveAttribute('aria-describedby', /.+/);
    const described = await field.evaluate((el) => (el.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '')
      .join(' '));
    expect(described).toMatch(/electronic signature/i);
    expect(described).toMatch(/ESIGN/);
  });

  test('switching method clears the other mark, so the form only ever submits what is on screen', async ({ page }) => {
    await gotoForm(page);
    await chooseInGroup(page, /Was this individual employed by your company/i, 'No / No Record Found');
    await fillRespondent(page);

    // Draw, then switch to Type: the drawing is gone and the typed field is empty.
    await signWithMouse(page);
    expect(await inkCount(page)).toBeGreaterThan(100);
    await typeToggle(page).click();
    await expect(canvas(page)).toHaveCount(0);
    await expect(typedField(page)).toHaveValue('');
    await expect(preview(page)).toHaveText('Your typed signature will appear here');

    // Type, then switch back to Draw: the pad is blank and required again.
    await typedField(page).fill('Alex Employer');
    await expect(preview(page)).toHaveText('Alex Employer');
    await drawToggle(page).click();
    await expect(canvas(page)).toHaveCount(1);
    expect(await inkCount(page)).toBe(0);
    await expect(page.getByText('Draw your signature here')).toBeVisible();
    await expect(page.getByRole('button', { name: /Clear Signature/i })).toBeDisabled();

    // Nothing signed survives either switch, so submitting is refused.
    await submitButton(page).click();
    await expect(errorSummary(page)).toBeVisible();
    await expect(errorSummary(page)).toContainText('Please provide your electronic signature');
  });

  test('has no serious axe violations in the Type state, empty and filled', async ({ page }) => {
    await gotoForm(page);
    await typeToggle(page).click();
    await expect(typedField(page)).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    await typedField(page).fill('Alex Employer');
    await expect(preview(page)).toHaveText('Alex Employer');
    expect(await seriousViolations(page)).toEqual([]);
  });
});
