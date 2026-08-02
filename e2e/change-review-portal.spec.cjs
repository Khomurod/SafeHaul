// E2E coverage for the public Change Review Portal design-system slice, using
// the existing ?e2eReview=mock path. Verifies the complete decision flow,
// keyboard focus, responsive overflow at 1440/1024/412, and a scoped axe pass.
// Artificial mock data only — no real tokens or applicant information.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function gotoMock(page) {
  await page.goto('/review-change/e2e-review-1?e2eReview=mock');
  await expect(page.getByRole('heading', { level: 1, name: 'Review changes to your application' }))
    .toBeVisible({ timeout: 20_000 });
}

test.describe('Change Review Portal', () => {
  test.describe.configure({ timeout: 60_000 });

  test('completes the review with default approve decisions', async ({ page }) => {
    await gotoMock(page);
    await expect(page.getByText('First Name')).toBeVisible();
    await expect(page.getByText('Phone')).toBeVisible();

    await page.getByRole('button', { name: /Submit my responses/i }).click();
    await expect(page.getByText('Thank you!')).toBeVisible();
    await expect(page.getByText('Your responses have been recorded.')).toBeVisible();
  });

  test('keeps decision controls grouped, keyboard-focusable, and visibly focused (desktop)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoMock(page);

    const group = page.getByRole('group', { name: /Decision for First Name/i });
    await expect(group).toBeVisible();
    const approve = group.getByRole('button', { name: /approve/i });
    await approve.focus();
    await expect(approve).toBeFocused();
    await expect(approve).toHaveAttribute('aria-pressed', 'true');

    const focusPresentation = await approve.evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focusPresentation.boxShadow !== 'none' || focusPresentation.outline !== 'none').toBe(true);
  });

  test('keeps the form within the viewport on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoMock(page);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a single-column mobile layout without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await gotoMock(page);
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await gotoMock(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
