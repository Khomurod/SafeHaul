/**
 * A list page on a tablet: wider than the phone layout (767px and below), too
 * narrow for the toolbar's one row. The tools then take a row of their own
 * from the left edge, never a group hanging at the right under the segments
 * (a stair-step), and nothing runs past the table's edge. A page's actions stay
 * on its title row here. The visual contract measures 412 and 1440 only, so
 * these widths are held here.
 */
const { test, expect } = require('@playwright/test');

const AUTH = '?e2eAuth=company_admin';

/**
 * The page row of the list toolbar once the window has settled (the wrap is
 * measured by a `ResizeObserver`, a frame after the resize): whether it says
 * it wrapped, its edges, the bottom of what leads it (scope, segments), and
 * where its tools start and end.
 */
async function toolbarRow(page) {
  return page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))));
    const toolbar = document.querySelector('.ds-list-toolbar[data-placement="page"]');
    const bar = toolbar.querySelector('.ds-list-toolbar__bar');
    const tools = toolbar.querySelector('.ds-list-toolbar__tools');
    const front = [...bar.children].filter((child) => child !== tools).map((child) => child.getBoundingClientRect());
    const parts = [...tools.children].map((child) => child.getBoundingClientRect());
    const box = bar.getBoundingClientRect();
    return {
      wrapped: toolbar.hasAttribute('data-wrapped'),
      barLeft: box.left,
      barRight: box.right,
      frontBottom: Math.max(...front.map((rect) => rect.bottom)),
      toolsTop: Math.min(...parts.map((rect) => rect.top)),
      firstLeft: parts[0].left,
      lastRight: Math.max(...parts.map((rect) => rect.right)),
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

/** Every width from `from` to `to` in `step`s, narrowing then widening. */
function sweep(from, to, step) {
  const widths = [];
  for (let width = from; width <= to; width += step) widths.push(width);
  return [...[...widths].reverse(), ...widths];
}

test.describe('a list page on a tablet', () => {
  for (const { list, path, ready, step } of [
    { list: 'Applications', path: '/company/drivers/applications', ready: 'Maria Garcia', step: 4 },
    { list: 'Leads', path: '/company/drivers/leads/company', ready: 'Lena Leadsen', step: 8 },
  ]) {
    test(`wraps the ${list} toolbar's tools as one row from the left, never a stair-step`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1460, height: 800 });
      await page.goto(`${path}${AUTH}`);
      await expect(page.getByText(ready)).toBeVisible({ timeout: 15_000 });

      const problems = [];
      for (const width of sweep(760, 1460, step)) {
        await page.setViewportSize({ width, height: 800 });
        const row = await toolbarRow(page);
        const ownRow = row.toolsTop >= row.frontBottom - 1;
        if (ownRow !== row.wrapped) problems.push(`${width}px: tools on their own row ${ownRow}, data-wrapped ${row.wrapped}`);
        if (row.wrapped && Math.abs(row.firstLeft - row.barLeft) > 1) {
          problems.push(`${width}px: the wrapped tools start ${row.firstLeft - row.barLeft}px from the row's left edge`);
        }
        if (row.lastRight > row.barRight + 1) problems.push(`${width}px: the tools end ${row.lastRight - row.barRight}px past the row`);
        if (row.pageScrollsSideways) problems.push(`${width}px: the page scrolls sideways`);
      }
      expect(problems).toEqual([]);
    });
  }

  test('keeps the segments inside their tray when the tools wrap under them', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(`/company/drivers/applications${AUTH}`);
    await expect(page.getByText('Maria Garcia')).toBeVisible({ timeout: 15_000 });

    const group = page.getByRole('group', { name: 'Pipeline segment' });
    const search = page.getByRole('searchbox');
    const [groupBox, searchBox] = await Promise.all([group.boundingBox(), search.boundingBox()]);
    // The tools have wrapped: the search sits under the segments, at the row's start.
    expect(searchBox.y).toBeGreaterThanOrEqual(groupBox.y + groupBox.height);
    expect(groupBox.height).toBeGreaterThanOrEqual(44);

    for (const segment of await group.getByRole('button').all()) {
      const box = await segment.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(groupBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(groupBox.x + groupBox.width);
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
