const { test, expect } = require('@playwright/test');
const {
  applySignature,
  completeRemainingSteps,
  continueToStep,
  expectStep,
  fillStep1,
  fillStep2,
  fillStep3RequiredFields,
  submitApplication,
  uploadStandardDocuments,
} = require('./helpers/wizardHelpers.cjs');

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

  test('a failed server save does not lose the newer local answers on reload', async ({ page }) => {
    // The reported bug, end to end. Driver edits a field, the local copy saves,
    // the server save fails, they reload — and the older server values used to
    // come back over their edit with nothing said.
    await page.goto('/apply/e2e-company?e2eResume=offer');
    await fillStep1(page, 'resume');

    // Continue from the server copy first, so the local copy starts out synced
    // with a known sequence and both copies genuinely exist.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Continue your existing application?', { timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Continue where I left off' }).click();
    await expectStep(page, 'Motor Vehicle Record');

    await page.getByRole('button', { name: 'Back' }).click();
    await expectStep(page, 'License');
    await expect(page.locator('#cdl-number')).toHaveValue('E2ERESTORED9');

    // Every save from here fails. No reload in between: a reload would discard the
    // in-memory state that makes the local copy the newer one.
    await page.evaluate(() => { window.__e2eFailDraftSave = true; });

    await page.fill('#cdl-number', 'LOCALNEWER1');
    // "Save as Draft" rather than Continue: this step legitimately refuses to
    // advance until the required documents are uploaded, and the point here is the
    // save, not the navigation.
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await expect(page.getByText('Progress saved.')).toBeVisible();

    // The local write succeeded and the server one did not, so the local copy now
    // holds work the server never acknowledged.
    const beforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem('draft_e2e-company')));
    expect(beforeReload.meta.localSeq).toBeGreaterThan(beforeReload.meta.syncedSeq);
    expect(beforeReload.data.cdlNumber).toBe('LOCALNEWER1');

    // Reload against the same server fixture, which still holds the old value.
    await page.goto('/apply/e2e-company?e2eResume=offer');
    // The furthest step either copy reached, not the one Save as Draft recorded —
    // the wizard's standing rule is never to move an applicant backwards, and the
    // merge means that page has data behind it.
    await expectStep(page, 'Motor Vehicle Record');
    await page.getByRole('button', { name: 'Back' }).click();
    await expectStep(page, 'License');

    // The edit survives. Before the fix this read back 'E2ERESTORED9'.
    await expect(page.locator('#cdl-number')).toHaveValue('LOCALNEWER1');
  });

  test('a synced local copy still yields to the server draft', async ({ page }) => {
    // The other direction, so the fix is not "always prefer local": with nothing
    // unsynced locally, the server copy is the one that is applied.
    await page.goto('/apply/e2e-company?e2eResume=offer');
    await fillStep1(page, 'resume');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Continue your existing application?', { timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Continue where I left off' }).click();
    await expectStep(page, 'Motor Vehicle Record');

    // Restored, therefore already synced — nothing local is newer.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('draft_e2e-company')));
    expect(stored.meta.localSeq).toBe(stored.meta.syncedSeq);

    await page.goto('/apply/e2e-company?e2eResume=offer');
    await expectStep(page, 'Motor Vehicle Record');
    await page.getByRole('button', { name: 'Back' }).click();
    await expectStep(page, 'License');
    await expect(page.locator('#cdl-number')).toHaveValue('E2ERESTORED9');
  });

  test('back navigation does not let a stale local copy beat the server', async ({ page }) => {
    // The wizard writes the local draft on EVERY navigation, Back included, and
    // Back sends no server save. So Back used to advance `localSeq` past
    // `syncedSeq` and permanently mark this device as holding unsynced work —
    // after which its copy beat genuinely newer work from another device for the
    // rest of the draft's life.
    await page.goto('/apply/e2e-company?e2eResume=offer');
    await fillStep1(page, 'resume');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Continue your existing application?', { timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Continue where I left off' }).click();
    await expectStep(page, 'Motor Vehicle Record');

    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('draft_e2e-company')));
    expect(restored.meta.localSeq).toBe(restored.meta.syncedSeq);

    // Navigate, without changing an answer. `exact` because the License step also
    // renders an "Upload CDL (Back)" control, which a substring match resolves to.
    await page.getByRole('button', { name: 'Back' }).click();
    await expectStep(page, 'License');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expectStep(page, 'Qualification');

    // Still clean: moving through the form is not applicant work.
    const afterBack = await page.evaluate(() => JSON.parse(localStorage.getItem('draft_e2e-company')));
    expect(afterBack.meta.localSeq).toBe(afterBack.meta.syncedSeq);

    // And the consequence that matters: the server copy is still the one applied.
    await page.goto('/apply/e2e-company?e2eResume=offer');
    await expectStep(page, 'Motor Vehicle Record');
    await page.getByRole('button', { name: 'Back' }).click();
    await expectStep(page, 'License');
    await expect(page.locator('#cdl-number')).toHaveValue('E2ERESTORED9');
  });

  test('a save that failed offline is sent when the connection returns', async ({ page }) => {
    await page.goto('/apply/e2e-company?e2eResume=offer');
    await fillStep1(page, 'resume');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Continue your existing application?', { timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Continue where I left off' }).click();
    await expectStep(page, 'Motor Vehicle Record');

    await page.getByRole('button', { name: 'Back' }).click();
    await expectStep(page, 'License');

    // Go offline for real — Chromium fires the same `offline`/`online` events the
    // listener is registered for — and make the save fail while it is down.
    await page.evaluate(() => { window.__e2eFailDraftSave = true; window.__e2eDraftSaves = []; });
    await page.context().setOffline(true);

    await page.fill('#cdl-number', 'OFFLINEEDIT');
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await expect(page.getByText('Progress saved.')).toBeVisible();

    const offline = await page.evaluate(() => ({
      draft: JSON.parse(localStorage.getItem('draft_e2e-company')),
      saves: (window.__e2eDraftSaves || []).length,
    }));
    expect(offline.draft.meta.localSeq).toBeGreaterThan(offline.draft.meta.syncedSeq);
    expect(offline.saves).toBe(0);

    // Reconnect. Nothing is typed and nothing is navigated: the flush is the
    // whole behaviour under test.
    await page.evaluate(() => { window.__e2eFailDraftSave = false; });
    await page.context().setOffline(false);

    await expect
      .poll(async () => page.evaluate(() => (window.__e2eDraftSaves || []).length), { timeout: 15_000 })
      .toBeGreaterThan(0);

    // The edit reached the server, and the local copy is no longer owed.
    const flushed = await page.evaluate(() => ({
      draft: JSON.parse(localStorage.getItem('draft_e2e-company')),
      saves: window.__e2eDraftSaves || [],
    }));
    expect(flushed.saves[0].formData.cdlNumber).toBe('OFFLINEEDIT');
    expect(flushed.draft.meta.localSeq).toBe(flushed.draft.meta.syncedSeq);
  });

  test('a resumed application cannot be submitted without the SSN it never stored', async ({ page }) => {
    // Requirement #4, end to end, with no fixture standing in for the failure: a
    // draft never stores the SSN, so an applicant who closes the browser and comes
    // back has no SSN in memory and never passes back through the page that asks
    // for it. Before this, that application submitted without one.
    test.setTimeout(180_000);

    await page.goto('/apply/e2e-company');
    await fillStep1(page, 'ssngone');
    await fillStep2(page);
    await fillStep3RequiredFields(page);
    await uploadStandardDocuments(page);
    await continueToStep(page, 'Motor Vehicle Record');

    // Closed browser, new visit. Only the local draft survives, and it never held
    // the SSN — the assertion below is on the stored copy, not on a mock.
    const stored = await page.evaluate(() => localStorage.getItem('draft_e2e-company'));
    expect(JSON.parse(stored).data).not.toHaveProperty('ssn');

    await page.goto('/apply/e2e-company');
    await expectStep(page, 'Motor Vehicle Record');

    await page.getByRole('button', { name: 'Back' }).click();
    await expectStep(page, 'License');
    // The uploads came back, so nothing else is blocking the submission.
    await expect(page.locator('[data-upload-field="cdl-front"]'))
      .toHaveAttribute('data-upload-state', 'uploaded');

    await continueToStep(page, 'Motor Vehicle Record');
    await completeRemainingSteps(page);
    await applySignature(page);
    await submitApplication(page);

    // Blocked, told exactly what is missing, and taken to the page that collects
    // it — not left with a server error at the end.
    await expect(page.getByText(/re-enter your Social Security Number/)).toBeVisible();
    await expectStep(page, 'Personal Information');
    await expect(page.locator('#ssn')).toHaveValue('');
    await expect(page.getByText('Application Submitted!')).toHaveCount(0);

    // The other half of the requirement: re-entering it lets the application
    // through. Everything else is still filled in, so this walks forward again.
    await page.fill('#ssn', '123-45-6789');
    await continueToStep(page, 'Qualification');
    await continueToStep(page, 'License');
    await continueToStep(page, 'Motor Vehicle Record');
    // Every answer is still in memory, so this is the same walk again; the
    // signature stays accepted and locked from the first pass.
    await completeRemainingSteps(page);
    await submitApplication(page);

    await expect(page.getByText('Application Submitted!')).toBeVisible({ timeout: 30_000 });
  });

  /**
   * Two real pages sharing one origin, so `localStorage` is genuinely shared and the
   * `storage` event is the browser's own rather than a synthetic one.
   *
   * The ordering is deliberate and load-bearing. The resume prompt is only offered to
   * a browser holding no token *at the moment its lookup runs*, and the token is
   * shared between tabs — so the discarding tab asks first and keeps its dialog open
   * while the other tab continues and takes ownership. That is also the honest
   * sequence: one applicant, two windows, and the decision taken in the second.
   */
  async function twoTabsOneApplication(context, page) {
    const discarding = await context.newPage();
    await discarding.goto('/apply/e2e-company?e2eResume=offer');
    await page.goto('/apply/e2e-company?e2eResume=offer');

    // The discarding tab asks first, before any token exists, and waits.
    await fillStep1(discarding, 'resume');
    const discardDialog = discarding.getByRole('dialog');
    await expect(discardDialog).toContainText('Continue your existing application?', { timeout: 30_000 });

    // The other tab continues, so what it now holds *is* the application about to be
    // discarded.
    await fillStep1(page, 'resume');
    const keepDialog = page.getByRole('dialog');
    await expect(keepDialog).toContainText('Continue your existing application?', { timeout: 30_000 });
    await keepDialog.getByRole('button', { name: 'Continue where I left off' }).click();
    await expectStep(page, 'Motor Vehicle Record');
    await page.getByRole('button', { name: 'Back' }).click();
    await expectStep(page, 'License');
    await expect(page.locator('#cdl-number')).toHaveValue('E2ERESTORED9');

    // And the discard goes through its two-stage confirmation.
    await discardDialog.getByRole('button', { name: 'Start a new application' }).click();
    await expect(discardDialog).toContainText('Start a new application?');
    await discardDialog.getByRole('button', { name: 'Delete it and start over' }).click();
    await expect(discarding.getByRole('dialog')).toHaveCount(0);
    await expect(discarding.getByText('Starting a new application.')).toBeVisible();

    return discarding;
  }

  test('a discard in one tab does not come back from another', async ({ page, context }) => {
    const discarding = await twoTabsOneApplication(context, page);

    // The other tab notices on its own, untouched: the wizard holding the discarded
    // answers is gone, replaced by the screen a first-time visitor gets.
    await expect(page.getByRole('button', { name: 'Fill Out Manually' }))
      .toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#cdl-number')).toHaveCount(0);

    // Nothing of the discarded application was written back by that tab.
    const stored = await page.evaluate(() => localStorage.getItem('draft_e2e-company'));
    expect(stored === null || !stored.includes('E2ERESTORED9')).toBe(true);
    const keptSaves = await page.evaluate(() => window.__e2eDraftSaves || []);
    for (const save of keptSaves) {
      expect(save.formData.cdlNumber).not.toBe('E2ERESTORED9');
    }

    // Starting again there begins genuinely empty.
    await page.getByRole('button', { name: 'Fill Out Manually' }).click();
    await expectStep(page, 'Personal Information');
    await expect(page.locator('#first-name')).toHaveValue('');

    await discarding.close();
  });

  test('a discarded application does not return when another tab reloads', async ({ page, context }) => {
    const discarding = await twoTabsOneApplication(context, page);

    // A guard rather than a fix: Start Over already clears the shared local draft and
    // token, so a reload was clean before this change too. It is here so the cross-tab
    // mechanism cannot quietly break the path that was already right — a reset that
    // wrote anything back would show up here.
    await page.goto('/apply/e2e-company');
    await expectStep(page, 'Personal Information');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#first-name')).toHaveValue('');

    await discarding.close();
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
    // Asserted on `data`, which is where the answers now live — checking the
    // envelope's top level would pass whatever the draft contained.
    expect(JSON.parse(stored.draft).data).not.toHaveProperty('ssn');
    expect(JSON.parse(stored.draft).data).not.toHaveProperty('signature');
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
