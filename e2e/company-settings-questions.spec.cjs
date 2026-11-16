// E2E coverage for Settings → Application questions → "Questions", the design-system
// slice. Verifies the accessible standard-field switches, the custom-question
// editor (labelled fields, keyboard reorder controls, no nested interactives),
// responsive overflow at 1440/1024/412, and a scoped axe pass. Data-shape and
// save contracts are covered by the vitest suite; no real Firestore write occurs.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const SETTINGS_URL = '/company/settings?e2eAuth=company_admin';

async function openQuestions(page) {
  await page.goto(`${SETTINGS_URL}&section=application`);
  await expect(page.getByRole('heading', { level: 1, name: 'Application questions' })).toBeVisible();
  /*
   * A `tab`, not a `button`: this strip is the approved `TabList`, so the
   * control announces as a tab in a tablist and the panel it shows is a
   * `tabpanel`. Tab *behaviour* with no ARIA tells assistive technology nothing
   * about the relationship this test is here to check.
   */
  await page.getByRole('tab', { name: 'Questions' }).click();
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
    const requireMed = page.getByRole('switch', { name: 'Require Signed MVR Authorization Form (upload)' });
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

  test('uses a mobile layout without horizontal overflow @mobile', async ({ page }, testInfo) => {
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

  test('splits the standard questions 50 / 25 / 25, the note the last row of their card', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1366, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await openQuestions(page);
      const geometry = await page.evaluate(() => {
        const table = [...document.querySelectorAll('table')].find((one) => one.querySelector('caption')?.textContent === 'Standard DOT questions');
        const tableWidth = table.getBoundingClientRect().width;
        const card = table.closest('.ds-card');
        const note = card.querySelector('.ds-notice[data-frame="flush"]');
        // What is drawn at the card's corner, just outside its curve: never a header cell.
        card.scrollIntoView({ block: 'start' });
        const cardTop = card.getBoundingClientRect();
        const corner = document.elementFromPoint(cardTop.left + 2, cardTop.top + 2);
        // The note is drawn, not cut off by the card.
        note.scrollIntoView({ block: 'center' });
        const cardBox = card.getBoundingClientRect();
        const noteBox = note.getBoundingClientRect();
        return {
          shares: [...table.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect().width / tableWidth),
          noteIsLast: note.nextElementSibling === null,
          noteShown: note.contains(document.elementFromPoint(noteBox.left + noteBox.width / 2, noteBox.top + noteBox.height / 2)),
          noteBottomGap: cardBox.bottom - noteBox.bottom,
          cornerIsCell: Boolean(corner?.closest('th, td')),
        };
      });
      expect(geometry.shares.map((share) => Math.round(share * 100)), `${width}px`).toEqual([50, 25, 25]);
      expect(geometry.noteIsLast).toBe(true);
      expect(geometry.noteShown).toBe(true);
      expect(geometry.noteBottomGap).toBeLessThanOrEqual(1);
      expect(geometry.cornerIsCell).toBe(false);
    }
  });

  test('counts the custom questions beside their heading, with Preview at the end of that row @mobile', async ({ page }, testInfo) => {
    await page.setViewportSize(testInfo.project.name.startsWith('mobile') ? { width: 412, height: 915 } : { width: 1440, height: 900 });
    await openQuestions(page);
    const heading = page.getByRole('heading', { level: 2, name: 'Custom Questions', exact: true });
    const count = page.getByRole('status').filter({ hasText: 'questions added' });
    await expect(count).toHaveText('0 questions added');
    const preview = page.getByRole('button', { name: 'Preview' });
    const [headingBox, countBox, previewBox] = await Promise.all([heading.boundingBox(), count.boundingBox(), preview.boundingBox()]);
    // The pill follows the heading on its line; Preview is centred on that line, at its end.
    expect(countBox.x).toBeGreaterThan(headingBox.x + headingBox.width);
    expect(Math.abs((countBox.y + countBox.height / 2) - (headingBox.y + headingBox.height / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs((previewBox.y + previewBox.height / 2) - (headingBox.y + headingBox.height / 2))).toBeLessThanOrEqual(2);
    expect(previewBox.x).toBeGreaterThan(countBox.x + countBox.width);
  });

  test('shows a field on a phone as one card: its name, then both switches on one line @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openQuestions(page);
    const ssn = page.getByRole('row', { name: /Social Security Number/ });
    const [card, name, require, requireWord, hide] = await Promise.all([
      ssn.boundingBox(),
      ssn.getByRole('rowheader').boundingBox(),
      ssn.getByRole('switch', { name: 'Require Social Security Number' }).boundingBox(),
      ssn.getByText('Required', { exact: true }).boundingBox(),
      ssn.getByRole('switch', { name: 'Hide Social Security Number' }).boundingBox(),
    ]);
    expect(require.y).toBeGreaterThanOrEqual(name.y + name.height);
    expect(Math.abs(require.y - hide.y)).toBeLessThanOrEqual(1);
    // Each switch comes before its word; the second pair starts at the card's middle.
    expect(requireWord.x).toBeGreaterThanOrEqual(require.x + require.width);
    expect(hide.x).toBeGreaterThan(requireWord.x + requireWord.width);
    expect(Math.abs(hide.x - (card.x + card.width / 2))).toBeLessThanOrEqual(8);
    // ...on every card, so the two columns line up down the list.
    const lastHide = await page.getByRole('switch', { name: 'Hide Emergency Contacts' }).boundingBox();
    expect(Math.abs(lastHide.x - hide.x)).toBeLessThanOrEqual(1);
  });

  test('keeps each rule switch on its title line and the experience choices in two columns @mobile', async ({ page }, testInfo) => {
    const phone = testInfo.project.name.startsWith('mobile');
    await page.setViewportSize(phone ? { width: 412, height: 915 } : { width: 1440, height: 900 });
    await page.goto(`${SETTINGS_URL}&section=application`);
    await page.getByRole('tab', { name: 'Rules' }).click();

    const geometry = await page.evaluate(() => {
      const row = document.querySelector('[data-rule-id="requirePreviousAddressUnderThreeYears"]');
      const title = row.querySelector('p').getBoundingClientRect();
      const toggle = row.querySelector('[role="switch"]').getBoundingClientRect();
      const choices = [...document.querySelector('[data-rule-id="experienceOptionsHidden"]').querySelectorAll('input[type="checkbox"]')]
        .map((box) => Math.round(box.getBoundingClientRect().left));
      return {
        switchOnTitleLine: toggle.top < title.top + 20 && toggle.left > title.right,
        experienceColumns: new Set(choices).size,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(geometry.switchOnTitleLine).toBe(true);
    expect(geometry.experienceColumns).toBe(2);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);

    // Report uploads: the same rows.
    await page.getByRole('tab', { name: 'Report uploads' }).click();
    const reports = await page.evaluate(() => [...document.querySelectorAll('[data-integration]')].map((row) => {
      const title = row.querySelector('p').getBoundingClientRect();
      const toggle = row.querySelector('[role="switch"]').getBoundingClientRect();
      return toggle.top < title.top + 20 && toggle.left > title.right;
    }));
    expect(reports).toEqual([true, true]);
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
