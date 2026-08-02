// E2E coverage for the EnvelopeCreator *shell*: the top bar's editable title,
// the FIXED creator mode, leaving the editor and the save action.
//
// The creator is opened through the Documents workspace's New Document dialog,
// which needs no PDF, so
// this spec never touches upload, PDF rendering, field coordinates, zoom or
// drag/drop — those belong to later sub-slices and are deliberately not
// exercised here. No document is saved: the save action is only inspected, never
// activated, so no Firestore/Storage write is attempted.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const { openCreator } = require('./helpers/edocHelpers.cjs');

test.describe('E-Doc envelope creator shell slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('opens in one-off mode with an editable title and the frozen save label', async ({ page }) => {
    await openCreator(page, 'request');

    await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Send Document' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Documents' })).toBeVisible();
  });

  test('opens in template mode with the frozen save label', async ({ page }) => {
    await openCreator(page, 'template');

    await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Save Template', exact: true })).toBeVisible();
  });

  test('renames the document from the top bar', async ({ page }) => {
    await openCreator(page, 'request');
    const title = page.getByLabel('Document title');
    await expect(title).toBeVisible({ timeout: 15_000 });

    await title.fill('Artificial Agreement');
    await title.blur();
    await expect(title).toHaveValue('Artificial Agreement');
    // Editing the title is a change, and the editor says so rather than
    // implying the work is safe.
    await expect(page.getByText('Unsaved changes').first()).toBeVisible();
  });

  test('states the chosen mode and offers no control that changes it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'The mode badges belong to the wide top bar.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCreator(page, 'request');
    await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 15_000 });

    // The mode is decided in the New Document dialog and is fixed here, so a
    // half-built envelope can never silently become a template.
    await expect(page.getByText('One-off send')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Creator mode' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'One-off Send' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save Template', exact: true })).toHaveCount(0);
  });

  test('leaving with nothing unsaved returns to the Documents workspace', async ({ page }) => {
    await openCreator(page, 'request');
    await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Back to Documents' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  });

  test('asks before discarding unsaved work, and keeps it when told to', async ({ page }) => {
    await openCreator(page, 'request');
    const title = page.getByLabel('Document title');
    await expect(title).toBeVisible({ timeout: 15_000 });
    await title.fill('Artificial Agreement');
    await title.blur();

    await page.getByRole('button', { name: 'Back to Documents' }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Document title')).toHaveValue('Artificial Agreement');
  });

  test('keeps the top bar keyboard reachable with visible focus', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCreator(page, 'request');
    await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 15_000 });

    const back = page.getByRole('button', { name: 'Back to Documents' });
    await back.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(back).toBeFocused();

    const focus = await back.evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focus.boxShadow !== 'none' || focus.outline !== 'none').toBe(true);
  });

  test('does not overflow the document at desktop/tablet/mobile', async ({ page }, testInfo) => {
    const widths = testInfo.project.name.startsWith('mobile') ? [412] : [1440, 1024];
    await page.setViewportSize({ width: widths[0], height: widths[0] === 412 ? 915 : 900 });
    await openCreator(page, 'request');
    await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 15_000 });

    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 412 ? 915 : 900 });
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    }
  });

  test('has no serious/critical or contrast violations in the top bar', async ({ page }) => {
    await openCreator(page, 'request');
    await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 15_000 });

    // Scoped to the editor top bar.
    const { violations } = await new AxeBuilder({ page }).include('.z-30').analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });
});
