/**
 * A list page on a tablet: wider than the phone layout (639px and below), too
 * narrow for the toolbar's one row. A page's actions stay on its title row
 * here. The visual contract measures 412 and 1440 only, so these widths are
 * held here.
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

  test("keeps a page's actions on the title row on a tablet, with the description below both", async ({ page }) => {
    const title = page.getByRole('heading', { level: 1, name: 'Referral Links' });
    const description = page.getByText(/^A link for a driver who sends you others\./);
    const action = page.getByRole('button', { name: 'Create link' });

    for (const width of [1440, 820]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 1440) await page.goto(`/company/referral-links${AUTH}`);
      await expect(action).toBeVisible({ timeout: 15_000 });
      await expect(async () => {
        const [heading, text, button] = await Promise.all([
          title.boundingBox(), description.boundingBox(), action.boundingBox(),
        ]);
        const buttonMiddle = button.y + button.height / 2;
        expect(buttonMiddle).toBeGreaterThanOrEqual(heading.y);
        expect(buttonMiddle).toBeLessThanOrEqual(heading.y + heading.height);
        expect(text.y).toBeGreaterThanOrEqual(heading.y + heading.height);
        expect(button.x).toBeGreaterThan(heading.x + heading.width);
      }).toPass();
    }
  });
});
