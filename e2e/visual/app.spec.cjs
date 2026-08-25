/**
 * Pixel baselines for real application screens.
 *
 * This is the coverage nothing else in the repository provides. The catalog
 * guards (`check:table-layout`, `check:visual-contract`, the catalog baselines)
 * all measure the *catalog*, and the roadmap is explicit about the limit of
 * that: "a feature screen with no story is not measured". A pattern can be
 * perfect while the screen it documents is not.
 *
 * Every route here uses the existing `?e2eAuth=` / `?e2e…=mock` harness that the
 * functional specs already use, so the data is deterministic fixture data and no
 * credentials are involved.
 *
 * Blocking in CI, as of 2026-08-25. Every one of these twenty baselines used to
 * fail on GitHub's runners, on every run, invisibly: the application fetched
 * Inter from rsms.me and the runner never received it, so each screenshot was a
 * whole page of substituted glyphs. The font is served from the repository now
 * (`design-system/tokens/typeface.css`), which is what makes these comparable
 * across machines. See the header of `catalog.spec.cjs`.
 *
 * Update baselines with:  npm run test:visual:update
 */
const { test, expect } = require('@playwright/test');
const { freezeClock, settle, SHOT } = require('./settle.cjs');

/**
 * A screen is listed with the thing that must be on it before a screenshot is
 * meaningful. Waiting on a real element rather than a network idle is what stops
 * a baseline capturing a half-rendered page — and what makes a genuine
 * regression fail here rather than produce a confusing diff.
 */
const SCREENS = [
    {
        name: 'company-dashboard',
        url: '/company/dashboard?e2eAuth=company_admin',
        ready: (page) => page.getByRole('heading', { name: /Welcome back/ }),
    },
    {
        name: 'company-candidate-list',
        url: '/company/drivers/applications?e2eAuth=company_admin',
        ready: (page) => page.getByRole('table').first(),
    },
    {
        name: 'company-settings',
        url: '/company/settings?e2eAuth=company_admin',
        ready: (page) => page.getByRole('heading', { level: 1 }).first(),
    },
    {
        name: 'company-profile',
        url: '/company/profile?e2eAuth=company_admin',
        ready: (page) => page.getByRole('heading', { level: 1 }).first(),
    },
    {
        name: 'company-edocs',
        url: '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock',
        ready: (page) => page.getByRole('tablist').first(),
    },
    {
        name: 'company-campaigns',
        url: '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock',
        ready: (page) => page.getByRole('heading', { level: 1 }).first(),
    },
    {
        name: 'super-admin',
        url: '/super-admin?e2eAuth=super_admin',
        /*
         * The totals, not the banner heading — and this is why `ready` is worth
         * choosing carefully rather than defaulting to `<h1>`.
         *
         * `<h1>Super Admin</h1>` is in the banner and present on first paint, so
         * the old predicate let the screenshot race the three metric cards. The
         * committed baseline had caught them mid-load showing `•••`; a run on
         * 2026-08-25 caught them resolved showing `0`, and the lane failed on a
         * diff of three glyphs with nothing wrong in the product. That is exactly
         * the failure a blocking lane cannot have: one flake teaches everyone to
         * disbelieve the next real regression.
         *
         * `DashboardView` announces the transition itself, so waiting on that
         * announcement pins the screenshot to the *settled* state rather than to
         * whichever side of the race the machine happened to be on.
         */
        ready: (page) => page.getByText('Platform totals loaded.'),
    },
    {
        name: 'login',
        url: '/login',
        ready: (page) => page.getByRole('button', { name: /Sign In/i }),
    },
    {
        name: 'public-application',
        url: '/apply/e2e-company',
        ready: (page) => page.getByRole('heading', { level: 1 }).first(),
    },
    {
        name: 'verification-portal',
        url: '/verify/e2e-token-1?e2eVerify=mock',
        ready: (page) => page.getByRole('heading', { level: 1 }).first(),
    },
    /*
     * Added 2026-08-25. The ten screens above were the ones the lane started
     * with; these five are the rest of the areas a user actually spends time in,
     * and every one of them was unmeasured while the lane was advisory:
     *
     *  - the signing room is where a legally operative signature is made;
     *  - the change-review portal is a public token route with no navigation
     *    around it, so nothing else on the screen would reveal a broken state;
     *  - Started (unfinished) and the two lead lists are three more tables, and
     *    tables are where this campaign found most of its geometry defects;
     *  - Import Leads carries the `FileInput` dropzone that four uploads
     *    migrated onto, so its appearance is now a shared contract rather than
     *    one screen's decision.
     */
    {
        name: 'signing-room',
        url: '/sign/e2e-company/e2e-request?token=e2e-token&e2eSign=mock',
        ready: (page) => page.getByRole('heading', { level: 1 }).first(),
    },
    {
        name: 'change-review-portal',
        url: '/review-change/e2e-token-1?e2eReview=mock',
        ready: (page) => page.getByRole('heading', { level: 1 }).first(),
    },
    {
        name: 'company-unfinished',
        /*
         * `e2eUnfinished=mock`, added 2026-08-25 because this screen was the one
         * in this list whose content came from a real callable. With no
         * credentials the call fails, and *how* it fails decides what renders:
         * the committed baseline was a loading skeleton captured in one
         * environment, and CI captured something 30% different. Every other
         * route here already uses a fixture harness; this one now does too.
         */
        url: '/company/drivers/unfinished?e2eAuth=company_admin&e2eUnfinished=mock',
        // A fixture row, not the `<h1>` — the heading paints before the data.
        ready: (page) => page.getByText('Dana Whitfield'),
    },
    {
        name: 'company-leads',
        url: '/company/drivers/leads/company?e2eAuth=company_admin',
        ready: (page) => page.getByRole('heading', { level: 1 }).first(),
    },
    {
        name: 'company-import-leads',
        url: '/company/import-leads?e2eAuth=company_admin',
        ready: (page) => page.getByRole('heading', { level: 1 }).first(),
    },
];

const WIDTHS = [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'mobile', width: 412, height: 915 },
];

test.describe('@visual application screens', () => {
    test.describe.configure({ timeout: 120_000 });

    for (const { label, width, height } of WIDTHS) {
        for (const screen of SCREENS) {
            test(`${screen.name} @ ${label}`, async ({ page }) => {
                await page.setViewportSize({ width, height });
                // Before navigating: a screen that stamps "now" would otherwise
                // re-baseline itself every day.
                await freezeClock(page);
                await page.goto(screen.url);
                // A real element, not `networkidle`: this app keeps Firestore
                // listeners open, so "idle" is a moving target.
                await expect(screen.ready(page)).toBeVisible({ timeout: 30_000 });
                await settle(page);
                await expect(page).toHaveScreenshot(`${screen.name}-${label}.png`, {
                    ...SHOT,
                    fullPage: true,
                });
            });
        }
    }
});
