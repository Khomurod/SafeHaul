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
    await expect(page.getByRole('heading', { name: 'Driver Applications' })).toBeVisible();
    await expect(page.getByText('Maria Garcia')).toBeVisible({ timeout: 15_000 });
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
    await expect(page.getByText('Showing 8 of 8 records')).toBeVisible();
    await expect(page.getByText('Lena Leadsen')).toHaveCount(0);

    // New: covers both 'New' and 'New Application' stored statuses.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByText('Maria Garcia')).toBeVisible();
    await expect(page.getByText('James McDonald')).toBeVisible();
    await expect(page.getByText('Aisha Robinson')).toHaveCount(0);
    await expect(page.getByText('Showing 2 of 2 records')).toBeVisible();

    // Hired: 'Hired' + legacy 'Approved'.
    await page.getByRole('button', { name: 'Hired', exact: true }).click();
    await expect(page.getByText('Aisha Robinson')).toBeVisible();
    await expect(page.getByText('Derek Nguyen')).toBeVisible();
    await expect(page.getByText('Showing 2 of 2 records')).toBeVisible();

    // Terminated.
    await page.getByRole('button', { name: 'Terminated', exact: true }).click();
    await expect(page.getByText('Linda Petrov')).toBeVisible();
    await expect(page.getByText('Showing 1 of 1 records')).toBeVisible();

    // Declined: 'Declined' + legacy 'Rejected'.
    await page.getByRole('button', { name: 'Declined', exact: true }).click();
    await expect(page.getByText('Carl Simmons')).toBeVisible();
    await expect(page.getByText('Rosa Rejectova')).toBeVisible();
    await expect(page.getByText('Showing 2 of 2 records')).toBeVisible();
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
    await expect(page.getByText('Showing 8 of 8 records')).toBeVisible();
  });

  test('search combines with the New filter', async ({ page }) => {
    await openApplications(page);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByText('Showing 2 of 2 records')).toBeVisible();

    // Maria is in the New segment.
    await searchFor(page, 'maria');
    await expect(page.getByText('Maria Garcia')).toBeVisible();
    await expect(page.getByText('James McDonald')).toHaveCount(0);

    // Aisha exists but is Hired — search inside the New tab must exclude her.
    await searchFor(page, 'aisha');
    await expect(page.getByText('No records found.')).toBeVisible();
  });

  test('My assignments combines with search and tabs', async ({ page }) => {
    await openApplications(page);

    await page.getByRole('button', { name: /My assignments/i }).click();
    // Maria + Aisha are assigned to the e2e admin.
    await expect(page.getByText('Showing 2 of 2 records')).toBeVisible();
    await expect(page.getByText('Maria Garcia')).toBeVisible();
    await expect(page.getByText('Aisha Robinson')).toBeVisible();

    // My assignments + New tab -> only Maria.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByText('Maria Garcia')).toBeVisible();
    await expect(page.getByText('Showing 1 of 1 records')).toBeVisible();

    // My assignments + New + search for someone not assigned -> empty.
    await searchFor(page, 'james');
    await expect(page.getByText('No records found.')).toBeVisible();
  });
});
