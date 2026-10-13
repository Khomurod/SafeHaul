const { test, expect } = require('@playwright/test');

test('unauthorized user is redirected from company dashboard to login', async ({ page }) => {
  await page.goto('/company/dashboard');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
});

test('a signed-in account in no company is told so, and can sign out', async ({ page }) => {
  await page.goto('/?e2eAuth=no_company');

  await expect(page.getByRole('heading', { level: 1, name: 'Your account has no company access' })).toBeVisible();
  await expect(page.getByText(/signed in as no_company@safehaul\.local/)).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
});
