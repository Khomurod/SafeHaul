// E2E coverage for the editor's compact (phone) layout: the bottom toolbar, the
// bottom sheets and their focus behaviour. Uses the e2eEdoc mock and an inline
// artificial PDF; nothing is sent and no real document or recipient is involved.
//
// The desktop rails are covered by edoc-envelope-sidebar / edoc-workbench-closeout
// / edoc-field-properties-panel, which pin a desktop viewport. This spec pins a
// phone viewport so both layouts are exercised on every lane.
const { test, expect } = require('@playwright/test');
const { openCreator } = require('./helpers/edocHelpers.cjs');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock';
const PHONE = { width: 412, height: 915 };

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

async function openCompactEditor(page) {
  await page.setViewportSize(PHONE);
  await openCreator(page, 'request', URL);
  await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('navigation', { name: 'Editor sections' })).toBeVisible();
}

test.describe('E-Doc compact editor', () => {
  test.describe.configure({ timeout: 90_000 });

  test('replaces the desktop rails instead of compressing them', async ({ page }) => {
    await openCompactEditor(page);

    await expect(page.getByRole('complementary', { name: 'Envelope setup' })).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Document inspector' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Pages' })).toHaveCount(0);
  });

  test('keeps every toolbar target comfortably tappable', async ({ page }) => {
    await openCompactEditor(page);
    const buttons = page.getByRole('navigation', { name: 'Editor sections' }).getByRole('button');

    const count = await buttons.count();
    expect(count).toBe(6);
    for (let index = 0; index < count; index += 1) {
      const box = await buttons.nth(index).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('opens each section in its own bottom sheet', async ({ page }) => {
    await openCompactEditor(page);

    for (const [trigger, title] of [
      ['Open Setup', 'Setup'],
      ['Open Add Field', 'Add Field'],
      ['Open Properties', 'Properties'],
      ['Open AI', 'AI Suggestions'],
    ]) {
      await page.getByRole('button', { name: trigger }).click();
      const sheet = page.getByRole('dialog', { name: title });
      await expect(sheet).toBeVisible();
      // Anchored to the bottom, within thumb reach, and never wider than the screen.
      const box = await sheet.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width + 1);
      expect(box.y + box.height).toBeGreaterThan(PHONE.height / 2);

      await page.getByRole('button', { name: `Close ${title}` }).click();
      await expect(sheet).toHaveCount(0);
    }
  });

  test('closes a sheet on Escape and gives focus back to its trigger', async ({ page }) => {
    await openCompactEditor(page);
    const trigger = page.getByRole('button', { name: 'Open Setup' });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Setup' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Setup' })).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('places a field from the Add Field sheet onto the document', async ({ page }) => {
    await openCompactEditor(page);

    await page.getByRole('button', { name: 'Open Setup' }).click();
    await page.setInputFiles('#pdf-upload', pdfFile('artificial-agreement.pdf'));
    await page.getByRole('button', { name: 'Close Setup' }).click();
    await expect(page.locator('[data-page-num="1"]').first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Open Add Field' }).click();
    await page.getByRole('button', { name: 'Add Text field', exact: true }).click();
    await page.getByRole('button', { name: 'Close Add Field' }).click();

    await expect(page.getByRole('group', { name: /text field on page 1/ }).first()).toBeVisible();
    // The toolbar states the count, so the sheet does not have to stay open.
    await expect(page.getByRole('button', { name: 'Open Fields, 1' })).toBeVisible();
  });

  test('never overflows the document horizontally', async ({ page }) => {
    await openCompactEditor(page);
    await page.getByRole('button', { name: 'Open Setup' }).click();

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious/critical or contrast violations in the compact chrome', async ({ page }) => {
    await openCompactEditor(page);
    await page.getByRole('button', { name: 'Open Setup' }).click();
    await expect(page.getByRole('dialog', { name: 'Setup' })).toBeVisible();

    // Scoped to the sheet panel itself, not `[role="dialog"]`: at this width the
    // company shell also keeps its own navigation drawer in the DOM, and its
    // markup is not what this spec is asserting on.
    const { violations } = await new AxeBuilder({ page })
      .include('.rounded-t-ds-xl')
      .include('nav[aria-label="Editor sections"]')
      .analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });
});
