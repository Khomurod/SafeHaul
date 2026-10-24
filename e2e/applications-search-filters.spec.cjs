const { test, expect } = require('@playwright/test');

/**
 * Applications page search + pipeline filters, driven against the E2E fixture
 * dataset (src/features/companies/hooks/e2eDashboardFixtures.js) through the
 * same pure classification/filter helpers the live Firestore path uses.
 */
test.describe('Applications search and pipeline filters', () => {
  test.describe.configure({ timeout: 90_000 });

  const APPLICATIONS_URL = '/company/drivers/applications?e2eAuth=company_admin';

  async function openApplications(page) {
    await page.goto(APPLICATIONS_URL);
    await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible();
    await expect(page.getByText('Maria Garcia')).toBeVisible({ timeout: 15_000 });
  }

  /** The number of applications beside the heading, as a screen reader reads it. */
  function listCount(page, count) {
    return page.getByText(`${count} application${count === 1 ? '' : 's'}`, { exact: true });
  }

  function searchBox(page) {
    return page.getByPlaceholder('Search name, phone, email...');
  }

  async function searchFor(page, term) {
    await searchBox(page).fill(term);
  }

  test('pipeline tabs render in order and filter by status vocabulary variants', async ({ page }) => {
    await openApplications(page);

    // Tab order: All Applications, New, Hired, Terminated, Declined.
    const tabs = page.locator('button', { hasText: /^(All Applications|New|Hired|Terminated|Declined)$/ });
    await expect(tabs).toHaveText(['All Applications', 'New', 'Hired', 'Terminated', 'Declined']);

    // All: every fixture application (8), never leads.
    await expect(listCount(page, 8)).toBeVisible();
    await expect(page.getByText('Lena Leadsen')).toHaveCount(0);

    // New: covers both 'New' and 'New Application' stored statuses.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByText('Maria Garcia')).toBeVisible();
    await expect(page.getByText('James McDonald')).toBeVisible();
    await expect(page.getByText('Aisha Robinson')).toHaveCount(0);
    await expect(listCount(page, 2)).toBeVisible();

    // Hired: 'Hired' + legacy 'Approved'.
    await page.getByRole('button', { name: 'Hired', exact: true }).click();
    await expect(page.getByText('Aisha Robinson')).toBeVisible();
    await expect(page.getByText('Derek Nguyen')).toBeVisible();
    await expect(listCount(page, 2)).toBeVisible();

    // Terminated.
    await page.getByRole('button', { name: 'Terminated', exact: true }).click();
    await expect(page.getByText('Linda Petrov')).toBeVisible();
    await expect(listCount(page, 1)).toBeVisible();

    // Declined: 'Declined' + legacy 'Rejected'.
    await page.getByRole('button', { name: 'Declined', exact: true }).click();
    await expect(page.getByText('Carl Simmons')).toBeVisible();
    await expect(page.getByText('Rosa Rejectova')).toBeVisible();
    await expect(listCount(page, 2)).toBeVisible();
  });

  test('search works across names, email, phone formats, and confirmation number', async ({ page }) => {
    await openApplications(page);

    // First name (lowercase — case-insensitive match).
    await searchFor(page, 'maria');
    await expect(page.getByText('Maria Garcia')).toBeVisible();
    await expect(page.getByText('James McDonald')).toHaveCount(0);

    // Last name.
    await searchFor(page, 'mcdonald');
    await expect(page.getByText('James McDonald')).toBeVisible();
    await expect(page.getByText('Maria Garcia')).toHaveCount(0);

    // Full name with extra internal whitespace (whitespace-tolerant).
    await searchFor(page, '  james   mcdonald ');
    await expect(page.getByText('James McDonald')).toBeVisible();

    // Email.
    await searchFor(page, 'aisha.robinson@example.com');
    await expect(page.getByText('Aisha Robinson')).toBeVisible();
    await expect(page.getByText('James McDonald')).toHaveCount(0);

    // Formatted phone (fixture stores it unformatted).
    await searchFor(page, '(312) 555-0188');
    await expect(page.getByText('James McDonald')).toBeVisible();

    // Unformatted phone (fixture stores it formatted) + country code.
    await searchFor(page, '+1 713 555 0179');
    await expect(page.getByText('Aisha Robinson')).toBeVisible();

    // Confirmation number, lowercased.
    await searchFor(page, 'saf-2026-mar1a');
    await expect(page.getByText('Maria Garcia')).toBeVisible();
    await expect(page.getByText('James McDonald')).toHaveCount(0);

    // No match: clear empty state, not an error.
    await searchFor(page, 'zzz-no-such-driver');
    await expect(page.getByText('No records found.')).toBeVisible();

    // Clearing the search restores the full list.
    await searchFor(page, '');
    await expect(listCount(page, 8)).toBeVisible();
  });

  test('search combines with the New filter', async ({ page }) => {
    await openApplications(page);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(listCount(page, 2)).toBeVisible();

    // Maria is in the New segment.
    await searchFor(page, 'maria');
    await expect(page.getByText('Maria Garcia')).toBeVisible();
    await expect(page.getByText('James McDonald')).toHaveCount(0);

    // Aisha exists but is Hired — search inside the New tab must exclude her.
    await searchFor(page, 'aisha');
    await expect(page.getByText('No records found.')).toBeVisible();
  });

  test('Only mine combines with search and tabs', async ({ page }) => {
    await openApplications(page);

    await page.getByRole('switch', { name: 'Only mine' }).click();
    // Maria + Aisha are assigned to the e2e admin.
    await expect(listCount(page, 2)).toBeVisible();
    await expect(page.getByText('Maria Garcia')).toBeVisible();
    await expect(page.getByText('Aisha Robinson')).toBeVisible();

    // Only mine + New tab -> only Maria.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByText('Maria Garcia')).toBeVisible();
    await expect(listCount(page, 1)).toBeVisible();

    // Only mine + New + search for someone not assigned -> empty.
    await searchFor(page, 'james');
    await expect(page.getByText('No records found.')).toBeVisible();
  });

  test('the State filter picks a state by name and finds its applications', async ({ page }) => {
    await openApplications(page);
    await page.getByRole('button', { name: /^Filters/ }).click();

    // The fixture stores these three by postal code ("TX"); the list holds names.
    await page.getByRole('combobox', { name: 'State' }).selectOption('Texas');
    await expect(listCount(page, 3)).toBeVisible();
    await expect(page.getByText('Maria Garcia')).toBeVisible();
    await expect(page.getByText('Aisha Robinson')).toBeVisible();
    await expect(page.getByText('Derek Nguyen')).toBeVisible();
    await expect(page.getByText('James McDonald')).toHaveCount(0);

    await page.getByRole('combobox', { name: 'State' }).selectOption('All States');
    await expect(listCount(page, 8)).toBeVisible();
  });

  test('the date filter shows the applications created that day, and counts only them', async ({ page }) => {
    await openApplications(page);
    await page.getByRole('button', { name: /^Filters/ }).click();

    await page.getByLabel('Filter by date').fill('2026-07-10');
    await expect(listCount(page, 1)).toBeVisible();
    await expect(page.getByText('Maria Garcia')).toBeVisible();
    await expect(page.getByText('James McDonald')).toHaveCount(0);

    await page.getByLabel('Filter by date').fill('');
    await expect(listCount(page, 8)).toBeVisible();
  });
});
