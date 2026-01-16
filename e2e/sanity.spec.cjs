// e2e/sanity.spec.js
const { test, expect } = require('@playwright/test');

test.describe('SafeHaul Critical Systems', () => {

    // 1. Can the app load at all?
    test('Homepage loads successfully', async ({ page }) => {
        await page.goto('/');

        // Check if the title or a key element exists
        await expect(page).toHaveTitle(/HR Portal/);
    });

    // 2. Is the Login Portal broken?
    test('Login Page renders correctly', async ({ page }) => {
        await page.goto('/login');

        // Check for Email and Password inputs
        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();

        // Check for the "Sign In" button
        await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    // 3. Check Distribution Config Protection
    // This ensures the "Control Room" we built is secured
    test('Super Admin routes verify auth', async ({ page }) => {
        await page.goto('/super-admin');

        // Should redirect to login if not authenticated
        await expect(page).toHaveURL(/.*login/);
    });

});
