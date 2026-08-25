// E2E coverage for the Company Profile branding-upload design-system slice.
// Verifies the accessible file-input contract, keyboard focus, no nested
// interactive elements, responsive overflow at 1440/1024/412, and a scoped axe
// pass. The real upload is not triggered here (it needs Firebase Storage); the
// exact Storage/Firestore contracts are covered by the vitest suite.
//
// Rewritten 2026-08-25 for the approved `FileInput`. The control used to be a
// `Button` driving a hidden input, so these tests looked for a *button* and
// asserted the input was NOT inside a label. The design system's picker contract
// is the opposite by design: a real `<input type="file">`, visually hidden but
// focusable, inside a `<label>` styled as the visible control — which is what
// makes the whole label a click and drag-and-drop target with no handler, and
// puts the accessible name on the field rather than on the trigger. The tests
// keep their intent (named, keyboard-reachable, visibly focused, no *button*
// nesting, accepted types announced) and follow that shape.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openBrandingEditing(page) {
  await page.goto(SETTINGS_URL);
  await expect(page.getByTestId('company-information')).toBeVisible();
  await page.getByRole('button', { name: 'Edit Profile' }).click();
  // The picker is the field, named "Company logo"; its visible text is the
  // label's ("Upload logo" / "Change logo").
  await expect(page.getByText(/change logo|upload logo/i)).toBeVisible();
}

test.describe('Company Settings branding upload compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes a labelled file input with visible accepted types', async ({ page }) => {
    await openBrandingEditing(page);

    /*
     * `getByRole('button')`, because that is the ARIA role an `<input
     * type="file">` maps to — this is how assistive technology sees the control,
     * and it is why the accessible name has to be the field rather than the
     * trigger's words.
     */
    const input = page.getByRole('button', { name: 'Company logo', exact: true });
    await expect(input).toHaveAttribute('accept', 'image/*');
    await expect(input).toHaveAttribute('type', 'file');
    // The name is on the FIELD now, not on the trigger. `aria-label` is gone in
    // favour of `aria-labelledby` pointing at the field label, which is what
    // makes it announce as "Company logo" rather than as "Upload logo".
    await expect(input).toHaveAccessibleName('Company logo');
    await expect(page.getByText(/Accepts image files/i)).toBeVisible();
    // …and the accepted types are its description, so they are heard before the
    // picker opens rather than discovered from a rejection afterwards.
    const describedBy = await input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy.split(' ').pop()}`)).toContainText(/Accepts image files/i);
  });

  test('keeps the upload trigger keyboard-focusable with visible focus and no nesting', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBrandingEditing(page);

    // Editing autofocuses Company Name; the upload trigger is the previous
    // focusable in the identity card.
    const companyName = page.getByRole('textbox', { name: 'Company Name' });
    await expect(companyName).toBeFocused();

    const input = page.getByRole('button', { name: 'Company logo', exact: true });
    await page.keyboard.press('Shift+Tab');
    await expect(input).toBeFocused();

    /*
     * The ring is drawn on the label, through `:focus-within` — the input itself
     * is clipped to 1x1, so an outline on it would be invisible. That is the
     * contract, so this measures the element the user actually sees.
     */
    const focusPresentation = await input.evaluate((el) => {
      const label = el.closest('label');
      const s = getComputedStyle(label);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle, target: label.getBoundingClientRect().height };
    });
    expect(focusPresentation.boxShadow !== 'none' || focusPresentation.outline !== 'none').toBe(true);
    // The label is the pointer target, so it is the thing that must be big enough.
    expect(focusPresentation.target).toBeGreaterThanOrEqual(24);

    const nesting = await page.evaluate(() => {
      const input = document.querySelector('input[type="file"]');
      const label = input.closest('label');
      return {
        // Still forbidden: an input inside a button is the shape that broke the
        // keyboard path in the controls this replaced.
        insideButton: !!input.closest('button'),
        // Its own label is the contract. What must not happen is a second
        // interactive element sharing that label.
        insideLabel: !!label,
        otherInteractiveInLabel: label
          ? label.querySelectorAll('button, a[href], select, textarea, input:not([type=file])').length
          : 0,
      };
    });
    expect(nesting.insideButton).toBe(false);
    expect(nesting.insideLabel).toBe(true);
    expect(nesting.otherInteractiveInLabel).toBe(0);
  });

  test('keeps the branding block within the viewport on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await openBrandingEditing(page);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a single-column mobile layout without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openBrandingEditing(page);

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious or critical accessibility violations in edit mode', async ({ page }) => {
    await openBrandingEditing(page);

    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
