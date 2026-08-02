// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// Sandboxed/CI-adjacent environments may provide a system Chromium instead of
// Playwright-managed downloads. When set, chromium-based projects use it.
const chromiumExecutablePath = process.env.PW_CHROMIUM_EXECUTABLE;
const chromiumLaunchOverride = chromiumExecutablePath
    ? { launchOptions: { executablePath: chromiumExecutablePath } }
    : {};

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
    testDir: './e2e',
    testMatch: '**/*.spec.cjs',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:5000',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], ...chromiumLaunchOverride },
        },
        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },
        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },
        // C1: First-class mobile device-emulation projects (real UA, DPR, touch, viewport)
        // so mobile-primary driver journeys are a permanent lane, not one-off setViewportSize.
        {
            name: 'mobile-safari',
            use: { ...devices['iPhone 13'] },
        },
        {
            // Chromium-based (Pixel 7) — must honor the same PW_CHROMIUM_EXECUTABLE
            // override as the desktop `chromium` project so a system Chromium is used
            // for the mobile lane too (CI/sandbox parity).
            name: 'mobile-chrome',
            use: { ...devices['Pixel 7'], ...chromiumLaunchOverride },
        },
    ],
    /* Run your local dev server before starting the tests */
    webServer: {
        command: 'npm run dev',
        env: {
            ...process.env,
            VITE_E2E_TEST_MODE: '1',
        },
        url: 'http://localhost:5000',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000, // Give it 2 mins to start up if needed
    },
});
