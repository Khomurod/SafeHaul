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
    /*
     * Visual baselines live beside the spec that records them, one directory per
     * spec file, and are named per platform by Playwright. Committed to the
     * repository — the roadmap's open question about *where* baselines live is
     * answered by "here", which needs no external service and no credentials.
     */
    snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
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
            // The visual lane owns `e2e/visual`; the functional lanes must not
            // also run it, or a sharded run would capture the same baselines
            // several times over.
            testIgnore: '**/visual/**',
        },
        {
            name: 'firefox',
            testIgnore: '**/visual/**',
            use: { ...devices['Desktop Firefox'] },
        },
        {
            name: 'webkit',
            testIgnore: '**/visual/**',
            use: { ...devices['Desktop Safari'] },
        },
        // C1: First-class mobile device-emulation projects (real UA, DPR, touch, viewport)
        // so mobile-primary driver journeys are a permanent lane, not one-off setViewportSize.
        {
            name: 'mobile-safari',
            testIgnore: '**/visual/**',
            use: { ...devices['iPhone 13'] },
        },
        {
            // Chromium-based (Pixel 7) — must honor the same PW_CHROMIUM_EXECUTABLE
            // override as the desktop `chromium` project so a system Chromium is used
            // for the mobile lane too (CI/sandbox parity).
            name: 'mobile-chrome',
            testIgnore: '**/visual/**',
            use: { ...devices['Pixel 7'], ...chromiumLaunchOverride },
        },
        /*
         * Visual regression. Its own project because it sets its own viewport per
         * test and must not inherit a device's deviceScaleFactor — a 2x DPR would
         * double every baseline's size and make the mobile and desktop captures
         * incomparable.
         *
         * Kept out of the default functional run, which matters because Playwright
         * runs EVERY configured project when none is named — declaring a separate
         * project does not make it opt-in. `npm run test:e2e` therefore lists the
         * functional projects explicitly; without that, a clean checkout running
         * it would fail here, since the catalog half needs `storybook-static`
         * built first. Run this one with `npm run test:visual`.
         */
        {
            name: 'visual',
            testDir: './e2e/visual',
            use: {
                ...devices['Desktop Chrome'],
                ...chromiumLaunchOverride,
                deviceScaleFactor: 1,
            },
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
