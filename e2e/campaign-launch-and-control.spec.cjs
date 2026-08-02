const { test, expect } = require('@playwright/test');

test.describe('campaign launch UX', () => {
  test.describe.configure({ timeout: 60_000 });

  test('company admin can launch a campaign in E2E mock mode', async ({ page }) => {
    await page.goto('/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock');

    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Create Campaign/i })).toBeVisible();
    await page.getByRole('button', { name: /Create Campaign/i }).click();

    await expect(page.getByRole('button', { name: /Launch/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Launch/i }).click();

    await expect(page.getByText(/Ready for Liftoff/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Launch Immediately/i })).toBeEnabled();

    await page.getByRole('button', { name: /Launch Immediately/i }).click();
    await expect(page.getByText(/Confirm campaign launch/i)).toBeVisible();
    await page.getByRole('button', { name: /Confirm Launch/i }).click();

    await expect(page.getByRole('button', { name: /Create Campaign/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  });
});
