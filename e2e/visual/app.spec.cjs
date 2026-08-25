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
 * Non-blocking in CI for the same reason as the catalog lane — see the comment
 * at the top of `catalog.spec.cjs`.
 *
 * Update baselines with:  npx playwright test --project=visual --update-snapshots
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
        ready: (page) => page.getByRole('heading', { level: 1 }).first(),
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
