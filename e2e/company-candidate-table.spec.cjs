const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const AUTH = '?e2eAuth=company_admin';

async function openCandidatePage(page, path, heading) {
  await page.goto(`${path}${AUTH}`);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: `${heading} table` })).toBeVisible();
}

test.describe('Company candidate-list DataTable pilot', () => {
  test.describe.configure({ timeout: 90_000 });

  test('keeps column alignment synchronized and preserves sort and dossier workflows', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop alignment and keyboard workflow.');
    await openCandidatePage(page, '/company/drivers/applications', 'Driver Applications');

    const table = page.getByRole('table', { name: 'Driver Applications table' });
    const statusHeader = table.getByRole('columnheader', { name: 'Status' });
    const mariaRow = table.getByRole('row', { name: 'Open driver dossier for Maria Garcia' });
    const mariaStatus = mariaRow.getByRole('cell', { name: 'New Application' });

    await expect(statusHeader).toHaveAttribute('data-align', 'center');
    await expect(mariaStatus).toHaveAttribute('data-align', 'center');
    await expect(statusHeader).toHaveAttribute('data-width', 'sm');
    await expect(mariaStatus).toHaveAttribute('data-width', 'sm');

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

    await page.getByRole('button', { name: 'Call Maria Garcia', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Log call result' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Driver dossier' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close call result' }).click();

    await page.getByRole('button', { name: 'Sort by latest added date' }).click();
    await expect(table.locator('tbody tr').first()).toContainText(/James Mcdonald/i);
    await page.getByRole('button', { name: 'Sort by latest added date' }).click();
    await expect(table.locator('tbody tr').first()).toContainText(/Maria Garcia/i);
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

  test('exposes every column through the documented mobile scroll pattern', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation is verified in a mobile project.');
    await openCandidatePage(page, '/company/drivers/applications', 'Driver Applications');

    const region = page.getByRole('region', {
      name: 'Driver Applications table. Scroll horizontally to view all columns.',
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
    await expect(page.getByRole('button', { name: 'Call Maria Garcia', exact: true })).toBeVisible();

    await page.getByRole('row', { name: 'Open driver dossier for Maria Garcia' })
      .click({ position: { x: 12, y: 12 } });
    await expect(page.getByRole('dialog', { name: 'Driver dossier' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Driver dossier' })).toHaveCount(0);
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
