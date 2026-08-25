// @ts-check
//
// The visual-regression lane, deliberately in its own config rather than as a
// project in `playwright.config.cjs`. See the note in that file where the
// project used to be: neither "declare it as a project" nor "name the other
// projects in the script" keeps it out of the default run, and the second of
// those actively broke CI.
//
// Everything except the project list is shared with the functional config, so
// the dev server, the snapshot path template and the retry/worker settings
// cannot drift between the two lanes.
//
// Run it with `npm run test:visual`; regenerate baselines with
// `npm run test:visual:update`.

const { devices } = require('@playwright/test');
const base = require('./playwright.config.cjs');

// Same override the functional config uses, so a sandbox or CI runner with a
// system Chromium instead of a Playwright-managed download still works here.
const chromiumExecutablePath = process.env.PW_CHROMIUM_EXECUTABLE;
const chromiumLaunchOverride = chromiumExecutablePath
    ? { launchOptions: { executablePath: chromiumExecutablePath } }
    : {};

module.exports = {
    ...base,
    projects: [
        /*
         * Its own project because it sets its own viewport per test and must not
         * inherit a device's deviceScaleFactor — a 2x DPR would double every
         * baseline's size and make the mobile and desktop captures incomparable.
         *
         * `testDir` stays './e2e/visual' because the base config's
         * `snapshotPathTemplate` interpolates `{testDir}`: changing it would move
         * every committed baseline path.
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
};
