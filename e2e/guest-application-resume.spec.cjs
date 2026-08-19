const { test, expect } = require('@playwright/test');
const { fillStep1, expectStep } = require('./helpers/wizardHelpers.cjs');

/**
 * "Continue your existing application?" — in a real browser.
 *
 * The dialog only appears when the server says a matching unfinished application
 * exists, and the end-to-end suite runs the SPA against no backend. So
 * `?e2eResume=offer` supplies that one fact; everything downstream of it — the
 * two-stage dialog, the restore, the discard, the local copies, the payload the
 * client builds — is the production code path.
 *
 * Both gates on that switch are in `applicationDraftService.js`: E2E mode is
 * never set in a production build, and `import.meta.env.PROD` refuses anyway.
 */
test.describe('guest application resume', () => {
  test.describe.configure({ timeout: 90_000 });

  const SSN = '123-45-6789';
  const SSN_DIGITS = '123456789';

  test('offers to continue, and restores the answers and the step', async ({ page }) => {
    await page.goto('/apply/e2e-company?e2eResume=offer');
    await fillStep1(page, 'resume');

    // The identity a resume is matched on is collected on page one, so the first
    // Continue is the first moment there is anything to match.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Continue your existing application?', { timeout: 30_000 });
    // Recognised is not identified: the dialog says when, and nothing else.
    await expect(dialog).toContainText('August 14');
    await expect(dialog).not.toContainText('Testresume');
    await expect(dialog).not.toContainText('@example.com');

    // Nothing has been written to the server yet. A save racing the lookup is how
    // the draft an applicant came back for gets overwritten or superseded before
    // they are asked about it.
    expect(await page.evaluate(() => (window.__e2eDraftSaves || []).length)).toBe(0);

    await dialog.getByRole('button', { name: 'Continue where I left off' }).click();

    // The saved step, not page one.
    await expectStep(page, 'Motor Vehicle Record');
    await expect(page.getByText('Your saved application has been restored.')).toBeVisible();

    // And the saved answers: one step back from Motor Vehicle Record is the
    // License page the restored draft filled in.
    await page.getByRole('button', { name: 'Back' }).click();
    await expectStep(page, 'License');
    await expect(page.locator('#cdl-number')).toHaveValue('E2ERESTORED9');
  });

  test('start over asks a second time, then begins genuinely clean', async ({ page }) => {
    await page.goto('/apply/e2e-company?e2eResume=offer');
    await fillStep1(page, 'resume');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Continue your existing application?', { timeout: 30_000 });

    // Escape must not be a deletion: `ConfirmDialog` routes it to cancel, so the
    // discard is its own explicit confirmation rather than the dismissal.
    await page.keyboard.press('Escape');
    await expect(dialog).toContainText('Start a new application?');
    await dialog.getByRole('button', { name: 'Keep my saved application' }).click();
    await expect(dialog).toContainText('Continue your existing application?');

    await dialog.getByRole('button', { name: 'Start a new application' }).click();
    await expect(dialog).toContainText('Start a new application?');
    await dialog.getByRole('button', { name: 'Delete it and start over' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Starting a new application.')).toBeVisible();

    // Where they already were, with their own answers — not the discarded draft's.
    await expectStep(page, 'Qualification');
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('apply_resume_e2e-company')))
      .not.toBeNull();

    await page.getByRole('button', { name: 'Back' }).click();
    await expectStep(page, 'Personal Information');
    await expect(page.locator('#first-name')).toHaveValue('Testresume');

    // The payload held back by the question is now the start of the new
    // application, and it was sent only after the discard.
    const saves = await page.evaluate(() => window.__e2eDraftSaves || []);
    expect(saves.length).toBeGreaterThan(0);
    expect(saves[0].formData.firstName).toBe('Testresume');
  });

  test('a discarded draft does not come back on the next visit', async ({ page }) => {
    await page.goto('/apply/e2e-company?e2eResume=offer');
    await fillStep1(page, 'resume');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Continue your existing application?', { timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Start a new application' }).click();
    await dialog.getByRole('button', { name: 'Delete it and start over' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // No `e2eResume`: the draft is gone server-side, so the token this browser
    // now holds is stale. The client must drop it and carry on rather than
    // retrying it on every load.
    await page.goto('/apply/e2e-company');
    await expectStep(page, 'Personal Information');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('apply_resume_e2e-company')))
      .toBeNull();
  });

  test('a returning device restores from the server without being asked', async ({ page }) => {
    await page.goto('/apply/e2e-company?e2eResume=offer');
    await fillStep1(page, 'resume');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Continue your existing application?', { timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Continue where I left off' }).click();
    await expectStep(page, 'Motor Vehicle Record');

    // Same device, fresh load. The token is the strongest resume path precisely
    // because it asks the applicant for nothing.
    await page.goto('/apply/e2e-company?e2eResume=offer');
    await expectStep(page, 'Motor Vehicle Record');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the SSN is never persisted or put in a draft payload', async ({ page }) => {
    const bodies = [];
    page.on('request', (request) => {
      const body = request.postData();
      if (body) bodies.push(body);
    });

    // No prompt in this one: start-over deliberately clears the local copy, and
    // the local copy is one of the three places the SSN must not be.
    await page.goto('/apply/e2e-company');
    await fillStep1(page, 'resume');
    await expect.poll(async () => page.evaluate(() => (window.__e2eDraftSaves || []).length))
      .toBeGreaterThan(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The local copy, and the resume token beside it.
    const stored = await page.evaluate(() => ({
      draft: localStorage.getItem('draft_e2e-company'),
      token: localStorage.getItem('apply_resume_e2e-company'),
    }));
    expect(stored.draft).not.toBeNull();
    expect(stored.draft).not.toContain(SSN);
    expect(stored.draft).not.toContain(SSN_DIGITS);
    expect(JSON.parse(stored.draft)).not.toHaveProperty('ssn');
    expect(JSON.parse(stored.draft)).not.toHaveProperty('signature');
    expect(stored.token).not.toContain(SSN_DIGITS);

    // The payload the client actually built. The SSN *is* a deliberate top-level
    // field — the server derives the identity HMAC from it and never stores it —
    // so the assertion is about `formData`, which is the part that is persisted.
    const saves = await page.evaluate(() => window.__e2eDraftSaves || []);
    for (const save of saves) {
      expect(save.formData).not.toHaveProperty('ssn');
      expect(save.formData).not.toHaveProperty('signature');
      expect(JSON.stringify(save.formData)).not.toContain(SSN_DIGITS);
    }

    // Nothing else on the page shipped it anywhere. In this mode the draft
    // callables are served from fixtures, so this is a sweep for an unexpected
    // sender (analytics, a logger) rather than a check of the callable itself —
    // the callable payload is pinned by the contract tests.
    for (const body of bodies) {
      expect(body).not.toContain(SSN_DIGITS);
      expect(body).not.toContain(SSN);
    }
  });
});
