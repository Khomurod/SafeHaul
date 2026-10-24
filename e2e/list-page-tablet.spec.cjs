/**
 * A list page on a tablet: wider than the phone layout (639px and below), too
 * narrow for the toolbar's one row or for a page's actions beside a long
 * description. The visual contract measures 412 and 1440 only, so these widths
 * are held here.
 */
const { test, expect } = require('@playwright/test');

const AUTH = '?e2eAuth=company_admin';

test.describe('a list page on a tablet', () => {
  test('keeps the toolbar segments full height when its tools wrap under them', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(`/company/drivers/applications${AUTH}`);
    await expect(page.getByText('Maria Garcia')).toBeVisible({ timeout: 15_000 });

    const group = page.getByRole('group', { name: 'Pipeline segment' });
    const search = page.getByRole('searchbox');
    const [groupBox, searchBox] = await Promise.all([group.boundingBox(), search.boundingBox()]);
    // The tools have wrapped: the search sits under the segments.
    expect(searchBox.y).toBeGreaterThanOrEqual(groupBox.y + groupBox.height);

    for (const segment of await group.getByRole('button').all()) {
      const box = await segment.boundingBox();
      if (box.x + box.width > groupBox.x + groupBox.width) continue; // scrolled out of view
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y).toBeGreaterThanOrEqual(groupBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(groupBox.y + groupBox.height);
    }
  });

  test("puts a page's actions under its description when both do not fit beside each other", async ({ page }) => {
    const description = page.getByText(/^A link for a driver who sends you others\./);
    const action = page.getByRole('button', { name: 'Create link' });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/company/referral-links${AUTH}`);
    await expect(action).toBeVisible({ timeout: 15_000 });
    let [text, button] = await Promise.all([description.boundingBox(), action.boundingBox()]);
    expect(button.y).toBeLessThan(text.y + text.height);

    await page.setViewportSize({ width: 820, height: 900 });
    await expect(async () => {
      [text, button] = await Promise.all([description.boundingBox(), action.boundingBox()]);
      expect(button.y).toBeGreaterThanOrEqual(text.y + text.height);
    }).toPass();
  });
});
