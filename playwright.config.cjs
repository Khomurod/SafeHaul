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
         * The visual-regression project is NOT here. It lives in
         * `playwright.visual.config.cjs`, and the reason is worth stating because
         * two plausible-looking alternatives are both wrong:
         *
         *   - Declaring it as a project here does not make it opt-in. Playwright
         *     runs EVERY configured project when none is named, so a clean
         *     checkout running `npm run test:e2e` would try the visual lane and
         *     fail — its catalog half needs `storybook-static` built first.
         *   - Naming the functional projects in the `test:e2e` script does not fix
         *     that either. `--project` ACCUMULATES on the command line, and CI
         *     runs `npm run test:e2e -- --project=chromium`, so a baked-in list
         *     unions with chromium and runs every project. That was tried on
         *     2026-08-25 and put 113 firefox tests into the chromium shard lane.
         *
         * A separate config is the only arrangement where no caller can get it
         * wrong: the visual lane is unreachable unless you ask for that config.
         */
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
