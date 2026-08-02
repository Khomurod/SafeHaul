const { test, expect } = require('@playwright/test');

test('unauthorized user is redirected from company dashboard to login', async ({ page }) => {
  await page.goto('/company/dashboard');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
});
