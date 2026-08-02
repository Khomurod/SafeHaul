// E2E coverage for the envelope creator's field-properties rail (sub-slice B).
//
// The rail only exists once a field is placed and selected, so each test opens
// the creator, attaches an artificial PDF, adds one field from the palette and
// selects it from the placed-fields list. Nothing is ever saved: no Firestore or
// Storage write is attempted, and no real document, recipient or signing link is
// used. Field geometry, drag/resize, zoom and the PDF workbench itself are out
// of scope for this slice and are not exercised.
const { test, expect } = require('@playwright/test');
const { openCreator } = require('./helpers/edocHelpers.cjs');
const AxeBuilder = require('@axe-core/playwright').default;
const { pdfFile } = require('./helpers/wizardHelpers.cjs');

const URL = '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock';

// The three-column layout is now desktop-only: below `lg` the inspector is a
// bottom sheet instead of a clipped third column, covered by
// e2e/edoc-editor-mobile.spec.cjs. This spec therefore sets a desktop viewport
// and the mobile lane checks the sheet's semantics.
/** The inspector column. */
const rail = (page) => page.getByRole('complementary', { name: 'Document inspector' });

async function openPropertiesFor(page, paletteField, { width = 1440 } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await openCreator(page, 'request', URL);
  await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 15_000 });

  // Artificial file only — the palette unlocks as soon as a PDF is attached.
  await page.setInputFiles('#pdf-upload', pdfFile('artificial-agreement.pdf'));
  // Sub-slice C gave every palette button a descriptive name ("Add Text field"),
  // so the plain field label is no longer the accessible name.
  await page.getByRole('button', { name: `Add ${paletteField} field`, exact: true }).click();

  // Select the placed field from the sidebar list. Sub-slice C turned each row
  // into a real button named "<label> P<page>", which replaces the page-badge
  // text click this helper used while that list was legacy markup.
  await page.getByRole('list', { name: /^Placed/ })
    .getByRole('button', { name: new RegExp(`${paletteField}.*P1`) })
    .click();
  await expect(rail(page).getByLabel('Field Label')).toBeVisible({ timeout: 10_000 });
}

test.describe('E-Doc field properties panel slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('opens the rail with every control for a text field', async ({ page }) => {
    await openPropertiesFor(page, 'Text');

    const panel = rail(page);
    await expect(panel.getByText('text Field')).toBeVisible();
    await expect(panel.getByLabel('Field Label')).toHaveValue('Text');
    await expect(panel.getByRole('checkbox', { name: 'Required Field' })).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: /Read Only/ })).toBeVisible();
    await expect(panel.getByLabel('Prefill Behavior')).toHaveValue('editable');
    await expect(panel.getByLabel('Default value')).toBeVisible();
    await expect(panel.getByLabel('Font Size')).toHaveValue('Auto');
  });

  test('edits the label and propagates it to the placed-field list', async ({ page }) => {
    await openPropertiesFor(page, 'Text');

    await rail(page).getByLabel('Field Label').fill('Artificial Clause');
    await expect(rail(page).getByLabel('Field Label')).toHaveValue('Artificial Clause');
    await expect(page.getByText('Artificial Clause').first()).toBeVisible();
  });

  test('toggles Required Field through the checkbox', async ({ page }) => {
    await openPropertiesFor(page, 'Text');

    const required = rail(page).getByRole('checkbox', { name: 'Required Field' });
    await expect(required).not.toBeChecked();
    await required.check();
    await expect(required).toBeChecked();
    await required.uncheck();
    await expect(required).not.toBeChecked();
  });

  test('keeps Read Only and Prefill Behavior in sync in both directions', async ({ page }) => {
    await openPropertiesFor(page, 'Text');

    const readOnly = rail(page).getByRole('checkbox', { name: /Read Only/ });
    const prefill = rail(page).getByLabel('Prefill Behavior');

    await readOnly.check();
    await expect(prefill).toHaveValue('locked');

    await prefill.selectOption('editable');
    await expect(readOnly).not.toBeChecked();

    await prefill.selectOption('locked');
    await expect(readOnly).toBeChecked();
  });

  test('changes the default value and the font size', async ({ page }) => {
    await openPropertiesFor(page, 'Text');

    const panel = rail(page);
    await panel.getByLabel('Default value').fill('{{full_name}}');
    await expect(panel.getByLabel('Default value')).toHaveValue('{{full_name}}');

    await panel.getByLabel('Font Size').selectOption('14');
    await expect(panel.getByLabel('Font Size')).toHaveValue('14');
  });

  test('hides prefill, default value and formatting for signature fields', async ({ page }) => {
    await openPropertiesFor(page, 'Signature');

    const panel = rail(page);
    await expect(panel.getByText('signature Field')).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: 'Required Field' })).toBeChecked();
    await expect(panel.getByLabel('Prefill Behavior')).toHaveCount(0);
    await expect(panel.getByLabel('Default value')).toHaveCount(0);
    await expect(panel.getByLabel('Font Size')).toHaveCount(0);
  });

  test('keeps the rail keyboard operable with a visible focus ring', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPropertiesFor(page, 'Text');

    const label = rail(page).getByLabel('Field Label');
    await label.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(label).toBeFocused();

    const focus = await label.evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focus.boxShadow !== 'none' || focus.outline !== 'none').toBe(true);

    // Tab order continues into the option toggles without a mouse.
    await page.keyboard.press('Tab');
    await expect(rail(page).getByRole('checkbox', { name: 'Required Field' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(rail(page).getByRole('checkbox', { name: /Read Only/ })).toBeFocused();
    await page.keyboard.press(' ');
    await expect(rail(page).getByLabel('Prefill Behavior')).toHaveValue('locked');
  });

  test('does not overflow the document at desktop and tablet widths', async ({ page }) => {
    await openPropertiesFor(page, 'Text');

    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    }
  });

  test('has no serious/critical or contrast violations in the rail', async ({ page }) => {
    await openPropertiesFor(page, 'Text');

    const { violations } = await new AxeBuilder({ page })
      .include('[aria-label="Document inspector"]')
      .analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });
});
