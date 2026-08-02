// E2E coverage for the placed-field overlay on the PDF workbench. Uses the
// e2eEdoc mock and an artificial one-page PDF; no real document, recipient or
// signing data is involved and nothing is sent.
//
// The percentage conversions, the 8px floor and the callback payloads are pinned
// in the vitest suite; this spec proves the overlay survives a real pointer
// gesture in a browser and stays reachable and named.
const { test, expect } = require('@playwright/test');
const { openCreator } = require('./helpers/edocHelpers.cjs');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock';

/** Minimal single-page PDF, generated inline so no fixture file is needed. */
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

async function placeField(page, paletteField) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCreator(page, 'request', URL);
  await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 15_000 });

  await page.setInputFiles('#pdf-upload', pdfFile('artificial-agreement.pdf'));
  await page.getByRole('button', { name: `Add ${paletteField} field`, exact: true }).click();

  // The overlay only exists once the page wrapper has rendered; wait for both so
  // no assertion (or axe include) races the PDF viewer.
  await expect(page.locator('[data-page-num="1"]').first()).toBeVisible({ timeout: 20_000 });

  // Remove and resize are contextual — they belong to the selected field — so
  // select it before asserting on either.
  await page
    .getByRole('group', { name: new RegExp(`${paletteField.toLowerCase()} field on page 1`) })
    .first()
    .focus();
  await expect(page.locator('.resize-handle').first()).toBeVisible({ timeout: 20_000 });
}

test.describe('E-Doc placed-field overlay', () => {
  test.describe.configure({ timeout: 90_000 });

  test('reveals the remove control and resize handle only on the selected field', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCreator(page, 'request', URL);
    await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 15_000 });
    await page.setInputFiles('#pdf-upload', pdfFile('artificial-agreement.pdf'));
    await page.getByRole('button', { name: 'Add Text field', exact: true }).click();
    await expect(page.locator('[data-page-num="1"]').first()).toBeVisible({ timeout: 20_000 });

    // Placing does not select, so an unselected field is a clean rectangle.
    await expect(page.locator('.resize-handle')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Remove .* from page 1$/ })).toHaveCount(0);

    await page.getByRole('group', { name: /text field on page 1/ }).first().focus();
    await expect(page.locator('.resize-handle').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Remove .* from page 1$/ })).toBeVisible();
  });

  test('names the overlay controls it places on the page', async ({ page }) => {
    await placeField(page, 'Text');

    // The overlay's own label editor and remove control are both named.
    await expect(page.getByRole('textbox', { name: /^Label for text field on page 1$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Remove .* from page 1$/ })).toBeVisible();
  });

  test('keeps the resize affordance visible without hover once selected', async ({ page }) => {
    await placeField(page, 'Text');

    const handle = page.locator('.resize-handle').first();
    await expect(handle).toBeVisible();
    const opacity = await handle.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBeGreaterThan(0);
  });

  test('resizes through a real pointer gesture and keeps the field on the page', async ({ page }) => {
    await placeField(page, 'Text');

    const overlay = page.locator('.resize-handle').first().locator('..');
    const before = await overlay.boundingBox();
    const handle = await page.locator('.resize-handle').first().boundingBox();

    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 120, handle.y + 40, { steps: 8 });
    await page.mouse.up();

    const after = await overlay.boundingBox();
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);

    // The resized field is still inside the page it belongs to.
    const page1 = page.locator('[data-page-num="1"]').first();
    const bounds = await page1.boundingBox();
    expect(after.x).toBeGreaterThanOrEqual(bounds.x - 1);
    expect(after.y).toBeGreaterThanOrEqual(bounds.y - 1);
  });

  test('edits the overlay label in place', async ({ page }) => {
    await placeField(page, 'Text');

    const label = page.getByRole('textbox', { name: /^Label for text field on page 1$/ });
    await label.fill('Artificial Label');
    await expect(label).toHaveValue('Artificial Label');
    // The sidebar's placed list reflects the same field.
    await expect(page.getByRole('list', { name: /^Placed/ })
      .getByRole('button', { name: /Artificial Label.*P1/ })).toBeVisible();
  });

  test('does not overflow the document while a field is placed', async ({ page }) => {
    await placeField(page, 'Signature');

    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    }
  });

  test('has no serious/critical or contrast violations around the placed field', async ({ page }) => {
    await placeField(page, 'Text');

    const { violations } = await new AxeBuilder({ page }).include('[data-page-num="1"]').analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });
});
