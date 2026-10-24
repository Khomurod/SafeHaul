const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const AUTH = '?e2eAuth=company_admin';

async function openCandidatePage(page, path, heading) {
  await page.goto(`${path}${AUTH}`);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: `${heading} table` })).toBeVisible();
}

/** All Applications with its filter panel open, and what the layout tests reach for. */
async function openApplicationsWithFilters(page) {
  await openCandidatePage(page, '/company/drivers/applications', 'Applications');
  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  await filters.click();
  return {
    filters,
    region: page.getByRole('region', {
      name: 'Applications table. Scroll horizontally to view all columns.',
    }),
    firstRow: page.getByRole('row', { name: 'Open driver dossier for Maria Garcia' }),
    // The last of the filter fields: the bottom of the Filters row.
    lastFilter: page.getByLabel('Filter by date'),
  };
}

// From the top of the list, the wheel over `anchor`, as a person scrolls:
// `scrollIntoView` would also move a box no person can scroll.
async function scrollToWithWheel(page, anchor, target) {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('*')) element.scrollTop = 0;
  });
  const from = await anchor.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.wheel(0, Math.max(0, to.y + to.height - page.viewportSize().height + 8));
  await expect(target).toBeInViewport();
}

test.describe('Company candidate-list DataTable pilot', () => {
  test.describe.configure({ timeout: 90_000 });

  test('keeps column alignment synchronized and preserves sort and dossier workflows', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop alignment and keyboard workflow.');
    await openCandidatePage(page, '/company/drivers/applications', 'Applications');

    const table = page.getByRole('table', { name: 'Applications table' });
    const statusHeader = table.getByRole('columnheader', { name: 'Status' });
    const mariaRow = table.getByRole('row', { name: 'Open driver dossier for Maria Garcia' });
    // Stored as "New Application"; the list shows its group's one name.
    const mariaStatus = mariaRow.getByRole('cell', { name: 'New', exact: true });

    await expect(statusHeader).toHaveAttribute('data-align', 'start');
    await expect(mariaStatus).toHaveAttribute('data-align', 'start');
    await expect(statusHeader).toHaveAttribute('data-width', 'lg');
    await expect(mariaStatus).toHaveAttribute('data-width', 'lg');

    const [headerBox, cellBox] = await Promise.all([
      statusHeader.boundingBox(),
      mariaStatus.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(cellBox).not.toBeNull();
    expect(Math.abs(
      (headerBox.x + (headerBox.width / 2)) - (cellBox.x + (cellBox.width / 2)),
    )).toBeLessThan(1);

    await mariaRow.focus();
    await mariaRow.press('Enter');
    await expect(page.getByRole('heading', { name: 'Application Review' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Application Review' })).toHaveCount(0);

    // The phone number is the call button.
    await page.getByRole('button', { name: 'Call Maria Garcia at (512) 555-0134', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Log call result' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Driver dossier' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close call result' }).click();

    // Newest first is the list's own order, and the Applied header says so;
    // pressing it turns the whole list oldest first, and again turns it back.
    const addedHeader = table.getByRole('columnheader', { name: 'Applied' });
    const added = addedHeader.getByRole('button', { name: 'Applied' });
    await expect(addedHeader).toHaveAttribute('aria-sort', 'descending');
    // The name as the driver wrote it.
    await expect(table.locator('tbody tr').first()).toContainText('James McDonald');
    await added.click();
    await expect(addedHeader).toHaveAttribute('aria-sort', 'ascending');
    await expect(table.locator('tbody tr').first()).toContainText(/Linda Petrov/i);
    await added.press('Enter');
    await expect(addedHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(table.locator('tbody tr').first()).toContainText('James McDonald');
  });

  test('uses native page-aware selection with a mixed select-all state', async ({ page }) => {
    await openCandidatePage(page, '/company/drivers/leads/company', 'Company Leads');

    const selectAll = page.getByRole('checkbox', { name: 'Select all candidates on this page' });
    const lena = page.getByRole('checkbox', { name: 'Select Lena Leadsen' });

    await lena.check();
    await expect(lena).toBeChecked();
    expect(await selectAll.evaluate((element) => element.indeterminate)).toBe(true);
    await expect(page.getByRole('button', { name: 'Assign (1)' })).toBeVisible();

    await selectAll.check();
    await expect(page.getByRole('checkbox', { name: 'Select Omar Attempt' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Assign (2)' })).toBeVisible();

    await page.getByRole('button', { name: 'Attempting to Contact' }).click();
    await expect(page.getByRole('button', { name: 'Assign (2)' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Select Omar Attempt' })).not.toBeChecked();
  });

  test('preserves the My Leads scope and its non-bulk-selection permissions', async ({ page }) => {
    await openCandidatePage(page, '/company/drivers/leads/my', 'My Leads');

    await expect(page.getByText('Lena Leadsen')).toBeVisible();
    await expect(page.getByText('Omar Attempt')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Assign \(/ })).toHaveCount(0);
  });

  test('exposes every column through the documented mobile scroll pattern @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation is verified in a mobile project.');
    await openCandidatePage(page, '/company/drivers/applications', 'Applications');

    const region = page.getByRole('region', {
      name: 'Applications table. Scroll horizontally to view all columns.',
    });
    const dimensions = await region.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
      tabIndex: element.tabIndex,
    }));

    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
    expect(dimensions.overflowX).toBe('auto');
    expect(dimensions.tabIndex).toBe(0);
    await expect(page.getByText('Swipe horizontally to view all columns and actions.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Call Maria Garcia at (512) 555-0134', exact: true })).toBeVisible();

    await page.getByRole('row', { name: 'Open driver dossier for Maria Garcia' })
      .click({ position: { x: 12, y: 12 } });
    await expect(page.getByRole('dialog', { name: 'Driver dossier' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Driver dossier' })).toHaveCount(0);
  });

  test('keeps the rows and the whole filter panel in reach on a phone @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone layout is verified in a mobile project.');
    const { filters, region, firstRow, lastFilter } = await openApplicationsWithFilters(page);

    // Upright, upright on a small phone, and on its side.
    for (const size of [null, { width: 412, height: 640 }, { width: 915, height: 412 }]) {
      if (size) await page.setViewportSize(size);
      await scrollToWithWheel(page, filters, lastFilter);
      await scrollToWithWheel(page, filters, firstRow);
      expect(await region.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(240);
    }
  });

  test('keeps the rows in reach in a short, wide window', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'A desktop window.');
    await page.setViewportSize({ width: 1024, height: 412 });
    const { filters, region, firstRow } = await openApplicationsWithFilters(page);

    await scrollToWithWheel(page, filters, firstRow);
    expect(await region.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(160);
  });

  test('has no serious or critical accessibility violations in the table surface', async ({ page }) => {
    await openCandidatePage(page, '/company/drivers/leads/company', 'Company Leads');

    const { violations } = await new AxeBuilder({ page })
      .include('.ds-data-table')
      .analyze();
    const severe = violations
      .filter((violation) => ['serious', 'critical'].includes(violation.impact))
      .map((violation) => `${violation.id} [${violation.impact}]`);

    expect(severe).toEqual([]);
  });
});
