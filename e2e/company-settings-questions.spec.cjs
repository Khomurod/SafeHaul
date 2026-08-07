// E2E coverage for the Company Profile "Application Form Questions" design-system
// slice. Verifies the accessible standard-field switches, the custom-question
// editor (labelled fields, keyboard reorder controls, no nested interactives),
// responsive overflow at 1440/1024/412, and a scoped axe pass. Data-shape and
// save contracts are covered by the vitest suite; no real Firestore write occurs.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openQuestions(page) {
  await page.goto(SETTINGS_URL);
  await expect(page.getByTestId('company-information')).toBeVisible();
  await page.getByRole('button', { name: 'Application Form Questions' }).click();
  await expect(page.getByRole('heading', { name: 'Standard DOT Questions', exact: true })).toBeVisible();
}

test.describe('Company Settings application-questions compatibility slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes accessible standard-field switches with unique names and state', async ({ page }) => {
    await openQuestions(page);

    const requireSsn = page.getByRole('switch', { name: 'Require Social Security Number' });
    const hideSsn = page.getByRole('switch', { name: 'Hide Social Security Number' });
    await expect(requireSsn).toHaveAttribute('aria-checked', 'true');
    await expect(hideSsn).toHaveAttribute('aria-checked', 'false');

    // Hiding clears required (exclusivity) — state is programmatic, not color-only.
    await hideSsn.click();
    await expect(hideSsn).toHaveAttribute('aria-checked', 'true');
    await expect(requireSsn).toHaveAttribute('aria-checked', 'false');
  });

  test('drives a standard switch from the keyboard with visible focus', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openQuestions(page);

    // MVR Consent is the gate this repo defaults to NOT required (it has never
    // been collected), which makes it the switch that starts off and can be
    // driven on from the keyboard. Medical Card Upload defaults on, because
    // that is what the application actually enforces.
    const requireMed = page.getByRole('switch', { name: 'Require MVR Consent Form' });
    // Land focus via the keyboard (a round-trip) so :focus-visible applies —
    // programmatic .focus() does not trigger focus-visible on a button.
    await requireMed.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(requireMed).toBeFocused();
    const focus = await requireMed.evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focus.boxShadow !== 'none' || focus.outline !== 'none').toBe(true);

    await expect(requireMed).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Space');
    await expect(requireMed).toHaveAttribute('aria-checked', 'true');
  });

  test('adds a custom question with labelled fields and keyboard reorder controls', async ({ page }) => {
    await openQuestions(page);

    await page.getByRole('button', { name: /Add your first question/i }).click();
    const group = page.getByRole('group', { name: 'Question 1' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('textbox', { name: 'Question 1 title' })).toBeVisible();
    await expect(group.getByRole('combobox', { name: 'Question 1 answer type' })).toBeVisible();
    await expect(group.getByRole('button', { name: 'Move question 1 up' })).toBeDisabled();
    await expect(group.getByRole('button', { name: 'Delete question 1' })).toBeVisible();

    // Ensure the controls are real buttons with no nested interactive elements.
    const hasNestedButton = await group.getByRole('button', { name: 'Delete question 1' })
      .evaluate((el) => el.querySelectorAll('button, a, input, select, textarea').length > 0);
    expect(hasNestedButton).toBe(false);
  });

  test('keeps the questions panel within the viewport on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await openQuestions(page);
      await page.getByRole('button', { name: /Add your first question/i }).click();
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a mobile layout without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openQuestions(page);
    await page.getByRole('button', { name: /Add your first question/i }).click();

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await openQuestions(page);
    await page.getByRole('button', { name: /Add your first question/i }).click();

    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
