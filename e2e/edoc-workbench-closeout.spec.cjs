// E2E coverage for the PDF workbench close-out: named zoom controls, keyboard
// field placement, and the properties rail that used to be clipped off-screen
// below ~600px. Uses the e2eEdoc mock and an inline artificial PDF; nothing is
// sent and no real document or recipient data is involved.
const { test, expect } = require('@playwright/test');
const { openCreator } = require('./helpers/edocHelpers.cjs');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock';

function pdfFile(name) {
  const pdf = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj',
    'trailer<</Root 1 0 R>>',
  ].join('\n');
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'utf8') };
}

/**
 * The desktop workbench. Below `lg` the editor is the compact layout, whose own
 * coverage is in e2e/edoc-editor-mobile.spec.cjs, so this spec pins a desktop
 * viewport rather than driving rails that deliberately are not rendered there.
 */
async function openWorkbench(page, { width = 1440 } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await openCreator(page, 'request', URL);
  await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 15_000 });
  await page.setInputFiles('#pdf-upload', pdfFile('artificial-agreement.pdf'));
  await expect(page.getByRole('toolbar', { name: 'Document canvas tools' })).toBeVisible({ timeout: 20_000 });
}

async function placeField(page, paletteField = 'Text') {
  await page.getByRole('button', { name: `Add ${paletteField} field`, exact: true }).click();
  await expect(page.locator('[data-page-num="1"]').first()).toBeVisible({ timeout: 20_000 });
  // The resize handle belongs to the selected field, and adding does not select,
  // so select it first.
  await page.getByRole('group', { name: new RegExp(`${paletteField.toLowerCase()} field on page 1`) }).first().focus();
  await expect(page.locator('.resize-handle').first()).toBeVisible({ timeout: 20_000 });
}

function sameBox(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Read the field's box once it has stopped changing between consecutive reads. */
async function settledBox(field, page) {
  let previous = await field.boundingBox();
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(50);
    const current = await field.boundingBox();
    if (sameBox(current, previous)) return current;
    previous = current;
  }
  return previous;
}

/**
 * Press a key, wait for the field's geometry to actually change, then return the
 * settled box.
 *
 * Reading `boundingBox()` straight after `keyboard.press` is a race: the handler
 * updates state, React re-renders and react-draggable applies the transform, all
 * asynchronously. A single read can land before any of that and report the old
 * position — which is how this test reported "Expected: > 386, Received: 386",
 * a zero-pixel move, on 1 of 4 local repeats even after the clamp fix.
 *
 * Waiting for a change also makes "the field did not move" a clear timeout
 * against a stated expectation rather than an arithmetic surprise.
 */
async function pressAndMeasure(field, page, key, previousBox) {
  await page.keyboard.press(key);
  await expect(async () => {
    expect(sameBox(await field.boundingBox(), previousBox)).toBe(false);
  }).toPass({ timeout: 10_000 });
  return settledBox(field, page);
}

/**
 * Select a placed field and pin it to the page's top-left corner.
 *
 * Both keyboard-geometry assertions need a starting position with room to grow.
 * The move handler clamps to `Math.max(0, …)` on the way up and left, and to
 * `Math.min(100 - width, …)` on the way down and right — so a field the palette
 * happened to drop against the bottom or right edge moves by *zero* when pressed
 * that way. That is exactly how the move test failed in CI: three attempts
 * measured deltas of 1.51 px, 1.49 px and finally 0 px, against a "baseline" that
 * itself drifted from 5.86 px to 1.22 px between attempts.
 *
 * Pressing up/left more times than the page has percentage steps lands the field
 * at exactly x=0, y=0 regardless of where it started, which makes every
 * subsequent down/right press unclamped and the measurement meaningful.
 */
async function selectAndPinToOrigin(page) {
  const field = page.getByRole('group', { name: /text field on page 1(, selected)?$/ }).first();
  await field.focus();
  await expect(field).toBeFocused();
  // Focusing selects the field, which fills the inspector. Measure only after
  // that, or the screen position moves for a reason that has nothing to do with
  // a key press.
  await expect(page.getByRole('complementary', { name: 'Document inspector' })
    .getByLabel('Field Label')).toBeVisible();

  for (let i = 0; i < 101; i += 1) {
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
  }

  // Wait for the pinned position to stop changing rather than sleeping a fixed
  // interval — react-draggable applies the transform asynchronously.
  await settledBox(field, page);

  // A page rendered too small makes a 1% step sub-pixel and the comparison
  // meaningless, so assert the canvas is a usable size before measuring.
  const pageBox = await page.locator('[data-page-num="1"]').first().boundingBox();
  expect(pageBox.width).toBeGreaterThan(200);
  expect(pageBox.height).toBeGreaterThan(200);

  return field;
}

test.describe('E-Doc workbench close-out', () => {
  test.describe.configure({ timeout: 90_000 });

  test('names every zoom control and announces the level', async ({ page }) => {
    await openWorkbench(page);
    const toolbar = page.getByRole('toolbar', { name: 'Document canvas tools' });
    const group = toolbar.getByRole('group', { name: 'PDF zoom' });

    await expect(group.getByRole('button', { name: 'Zoom out' })).toBeVisible();
    await expect(group.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await expect(group.getByRole('button', { name: /^Reset zoom to 100 percent/ })).toBeVisible();
    // The level is announced alongside the page, not only shown as a percentage.
    await expect(toolbar.getByRole('status')).toHaveText(/Page \d+ of \d+\. Zoom \d+ percent\./);
  });

  test('offers fit, paging, history and preview from one canvas toolbar', async ({ page }) => {
    await openWorkbench(page);
    const toolbar = page.getByRole('toolbar', { name: 'Document canvas tools' });

    await expect(toolbar.getByText('Page 1 / 1')).toBeVisible();
    // A one-page document has nowhere to page to, and says so rather than
    // offering a control that does nothing.
    await expect(toolbar.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await expect(toolbar.getByRole('button', { name: 'Next page' })).toBeDisabled();

    const reset = toolbar.getByRole('button', { name: /^Reset zoom to 100 percent/ });
    await toolbar.getByRole('button', { name: 'Fit Width' }).click();
    await expect(reset).not.toHaveText('100%');
    await toolbar.getByRole('button', { name: 'Fit Page' }).click();
    await expect(reset).toBeVisible();

    // Nothing has been edited yet, so there is nothing to undo or redo.
    await expect(toolbar.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect(toolbar.getByRole('button', { name: 'Redo' })).toBeDisabled();
    await expect(toolbar.getByRole('button', { name: 'Preview as signer' })).toBeEnabled();
  });

  test('undoes and redoes a placed field from the canvas toolbar', async ({ page }) => {
    await openWorkbench(page);
    const toolbar = page.getByRole('toolbar', { name: 'Document canvas tools' });
    await placeField(page);

    const field = page.getByRole('group', { name: /text field on page 1/ });
    await expect(field).toHaveCount(1);

    await toolbar.getByRole('button', { name: 'Undo' }).click();
    await expect(field).toHaveCount(0);

    await toolbar.getByRole('button', { name: 'Redo' }).click();
    await expect(field).toHaveCount(1);
  });

  test('previews the document as the signer would see it, writing nothing', async ({ page }) => {
    await openWorkbench(page);
    await placeField(page);

    await page.getByRole('toolbar', { name: 'Document canvas tools' })
      .getByRole('button', { name: 'Preview as signer' })
      .click();
    const preview = page.getByRole('dialog', { name: /Preview as signer/ });
    await expect(preview).toBeVisible();
    await expect(preview.getByText(/What the recipient sees/)).toBeVisible();

    await preview.getByRole('button', { name: 'Back to editing' }).click();
    await expect(preview).toHaveCount(0);
  });

  test('zooms out, in and back to the default from the keyboard', async ({ page }) => {
    await openWorkbench(page);
    const group = page.getByRole('toolbar', { name: 'Document canvas tools' })
      .getByRole('group', { name: 'PDF zoom' });
    const reset = group.getByRole('button', { name: /^Reset zoom to 100 percent/ });

    await expect(reset).toHaveText('100%');

    await group.getByRole('button', { name: 'Zoom out' }).click();
    await expect(reset).not.toHaveText('100%');

    await group.getByRole('button', { name: 'Zoom in' }).click();
    await expect(reset).toHaveText('100%');

    // Reset is reachable and operable without a pointer.
    await group.getByRole('button', { name: 'Zoom out' }).click();
    await reset.focus();
    await expect(reset).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(reset).toHaveText('100%');
  });

  test('moves a placed field with the keyboard alone', async ({ page }) => {
    await openWorkbench(page);
    await placeField(page);
    const field = await selectAndPinToOrigin(page);

    const origin = await settledBox(field, page);
    const afterRight = await pressAndMeasure(field, page, 'ArrowRight', origin);
    expect(afterRight.x).toBeGreaterThan(origin.x);

    // Shift moves further per press than a bare arrow (5% versus 1%). Both
    // measurements are one press on the *same* axis: the earlier revision
    // compared a single Shift+ArrowDown against two ArrowRight presses, so it
    // was weighing a y-delta against an unrelated x-delta and calling the
    // difference a step size.
    const afterBareDown = await pressAndMeasure(field, page, 'ArrowDown', afterRight);
    const bareStep = afterBareDown.y - afterRight.y;
    expect(bareStep).toBeGreaterThan(0);

    const afterShiftDown = await pressAndMeasure(field, page, 'Shift+ArrowDown', afterBareDown);
    expect(afterShiftDown.y - afterBareDown.y).toBeGreaterThan(bareStep);
  });

  test('resizes a placed field with Alt and an arrow key', async ({ page }) => {
    await openWorkbench(page);
    await placeField(page);

    // Pinned for the same reason as the move test: Alt+ArrowRight grows width
    // through `Math.min(100 - field.x, …)`, so a field sitting near the right
    // edge cannot grow and the assertion would compare a width to itself.
    const field = await selectAndPinToOrigin(page);

    const before = await settledBox(field, page);
    const after = await pressAndMeasure(field, page, 'Alt+ArrowRight', before);
    expect(after.width).toBeGreaterThan(before.width);
  });

  test('keeps the inspector inline and its width stable across selection', async ({ page }) => {
    await openWorkbench(page);
    const inspector = page.getByRole('complementary', { name: 'Document inspector' });
    await expect(inspector).toBeVisible();
    const before = await inspector.boundingBox();

    await placeField(page);
    await expect(inspector.getByLabel('Field Label')).toBeVisible();
    const after = await inspector.boundingBox();

    // The column does not collapse and reopen, so the canvas never resizes
    // under the pointer.
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious/critical or contrast violations in the workbench', async ({ page }) => {
    await openWorkbench(page);
    await placeField(page);

    const { violations } = await new AxeBuilder({ page })
      .include('[role="toolbar"][aria-label="Document canvas tools"]')
      .include('[data-page-num="1"]')
      .analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });
});
