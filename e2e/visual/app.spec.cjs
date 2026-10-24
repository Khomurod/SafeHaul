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
 * Blocking in CI. The font is served from the repository
 * (`design-system/tokens/typeface.css`), never fetched at runtime, which is what
 * makes these comparable across machines: a runner that cannot reach a font CDN
 * screenshots a whole page of substituted glyphs. See the header of
 * `catalog.spec.cjs`.
 *
 * ## Which screens, and why not all of them
 *
 * Two baselines a screen (1440, 412). The list is chosen, not exhaustive, and the
 * rule is: **a screen earns a baseline when a design-system change could break it
 * in a way no other guard would catch.** So it holds one of each workspace shape
 * (a dashboard of cards, a dense table, a settings form, a tabbed workspace, a
 * wizard), plus every screen a driver or an employer sees without logging in —
 * the public application, the signing room, the verification portal, the
 * change-review portal — because those have no operator to notice a regression
 * and report it.
 *
 * Deliberately absent, so the gap is a decision rather than an oversight:
 *
 *  - `/` — the landing page has its own approved specification in `DESIGN.md`
 *    and is out of this campaign's scope.
 *  - `/interest/:slug` — a compatibility redirect with no UI of its own.
 *  - `/sandbox/*` and `/e2e/voe-preview` — harness routes, not product.
 *  - The `/company` and `/super-admin` sub-views beyond the ones listed. These
 *    are the real remaining gap and it is a matter of cost: each baseline is two
 *    committed PNGs and two more comparisons on every run. A sub-view that
 *    reuses a shape already covered here gains little; one that introduces a new
 *    shape should be added, and adding it is two lines.
 *
 * Update baselines with:  npm run screenshots:pull -- <CI run id>
 */
const { test, expect } = require('@playwright/test');
const { freezeClock, settle, SHOT } = require('./settle.cjs');
const {
    AI_TELEMETRY, API_KEYS, BLOG_POSTS, BLOG_RUNS, ENVIRONMENT_INVENTORY, WEBSITE_LEADS, serveCallables,
} = require('../helpers/callables.cjs');
const { uploadLeadFile } = require('../helpers/leadImport.cjs');

/**
 * A screen is listed with the thing that must be on it before a screenshot is
 * meaningful — or, when parts of it load independently, every such thing.
 * Waiting on a real element rather than a network idle is what stops a baseline
 * capturing a half-rendered page — and what makes a genuine regression fail here
 * rather than produce a confusing diff.
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
        // A fixture row, so the count beside the heading has arrived too.
        ready: (page) => page.getByText('Maria Garcia'),
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
        name: 'company-edocs-sent',
        url: '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock&e2eEdocSent=mock',
        // The list is a tab of the workspace, pressed as a person would.
        open: (page) => page.getByRole('tab', { name: /^Sent Documents/ }).click(),
        ready: (page) => page.getByText('Ana Lucia Ferreira-Montgomery'),
    },
    {
        name: 'company-referral-links',
        url: '/company/referral-links?e2eAuth=company_admin&e2eReferrals=mock',
        ready: (page) => page.getByText('Rosa Delgado'),
    },
    {
        name: 'company-settings-api-keys',
        url: '/company/settings?section=api_keys&e2eAuth=company_admin',
        // The keys come from a callable, answered here as the server would.
        callables: { listCompanyApiKeys: API_KEYS },
        ready: (page) => page.getByText('Artificial TMS'),
    },
    {
        name: 'company-campaigns',
        url: '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock',
        ready: (page) => page.getByRole('heading', { level: 1 }).first(),
    },
    {
        name: 'super-admin-features',
        url: '/super-admin/features?e2eAuth=super_admin&e2eFeatures=mock',
        ready: (page) => page.getByText('Sample Haulage', { exact: true }),
    },
    {
        name: 'super-admin-blog-posts',
        url: '/super-admin/blog-posts?e2eAuth=super_admin',
        callables: { listBlogPosts: BLOG_POSTS, listBlogRuns: BLOG_RUNS },
        ready: (page) => page.getByText('Why drivers stay: five retention habits', { exact: true }),
    },
    {
        name: 'super-admin-ai-logs',
        url: '/super-admin/ai-integrations?e2eAuth=super_admin',
        callables: { listAiTelemetry: AI_TELEMETRY },
        open: (page) => page.getByRole('tab', { name: 'Logs' }).click(),
        ready: (page) => page.getByText('Request rejected by vendor', { exact: true }),
    },
    {
        name: 'super-admin-environment',
        url: '/super-admin/environment-integrations?e2eAuth=super_admin',
        callables: { listEnvironmentAndIntegrations: ENVIRONMENT_INVENTORY },
        ready: (page) => page.getByText('ARTIFICIAL_OPTIONAL_WEBHOOK_URL', { exact: true }),
    },
    {
        name: 'super-admin-website-leads',
        url: '/super-admin/website-leads?e2eAuth=super_admin',
        callables: { listLandingLeads: WEBSITE_LEADS },
        ready: (page) => page.getByText('Dev Patel', { exact: true }),
    },
    {
        name: 'super-admin',
        url: '/super-admin?e2eAuth=super_admin',
        /*
         * The totals and the Activity section, not the banner heading — and
         * this is why `ready` is worth choosing carefully rather than
         * defaulting to `<h1>`.
         *
         * `<h1>Super Admin</h1>` is in the banner and present on first paint, so
         * waiting on it lets the screenshot race the three metric cards: mid-load
         * on one run, resolved on the next, a diff with nothing wrong in the
         * product. That is exactly the failure a blocking lane cannot have: one
         * flake teaches everyone to disbelieve the next real regression.
         *
         * `DashboardView` announces the transition itself, so waiting on that
         * announcement pins the screenshot to the *settled* state rather than to
         * whichever side of the race the machine happened to be on.
         *
         * Either settled sentence: E2E mode has no backend, so the lists come
         * back empty from the cache and every count, which only the server can
         * answer, fails. The cards say "Error" for a count that failed, never 0.
         *
         * The Activity section below loads on its own, so it is waited on too:
         * its tab strip appears only once the period's figures are read (the
         * companies list comes back empty from the cache, so the period has no
         * calls; its dates come from the frozen clock), and its error state is
         * the other way it can settle. Whichever of the two arrives last, the
         * screenshot waits for it.
         */
        ready: (page) => [
            page.getByText(/^(Platform totals loaded\.|\d+ of \d+ platform totals failed to load: .+\.)$/),
            page.getByRole('tablist', { name: 'Activity views' })
                .or(page.getByRole('heading', { name: 'Activity could not be loaded' })),
        ],
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
     * These five are the rest of the areas a user actually spends time in:
     *
     *  - the signing room is where a legally operative signature is made;
     *  - the change-review portal is a public token route with no navigation
     *    around it, so nothing else on the screen would reveal a broken state;
     *  - Unfinished applications and the two lead lists are three more tables, and
     *    tables are where geometry defects most often show;
     *  - Import Leads carries the `FileInput` dropzone that four uploads share,
     *    so its appearance is a shared contract rather than one screen's
     *    decision.
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
         * `e2eUnfinished=mock`, because without it this screen's content comes
         * from a real callable. With no credentials the call fails, and *how* it
         * fails decides what renders, which differs from one environment to the
         * next. Every route here uses a fixture harness.
         */
        url: '/company/drivers/unfinished?e2eAuth=company_admin&e2eUnfinished=mock',
        // A fixture row, not the `<h1>` — the heading paints before the data.
        ready: (page) => page.getByText('Dana Whitfield'),
    },
    {
        name: 'company-leads',
        url: '/company/drivers/leads/company?e2eAuth=company_admin',
        ready: (page) => page.getByText('Omar Attempt'),
    },
    {
        name: 'company-my-leads',
        url: '/company/drivers/leads/my?e2eAuth=company_admin',
        ready: (page) => page.getByText('Lena Leadsen'),
    },
    {
        name: 'company-import-leads',
        url: '/company/import-leads?e2eAuth=company_admin',
        ready: (page) => page.getByRole('heading', { level: 1 }).first(),
    },
    {
        name: 'company-import-preview',
        url: '/company/import-leads?e2eAuth=company_admin',
        open: uploadLeadFile,
        // Exact: the email cell holds the same name.
        ready: (page) => page.getByText('Okonkwo-Fairweather', { exact: true }),
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
                if (screen.callables) await serveCallables(page, screen.callables);
                await page.goto(screen.url);
                if (screen.open) await screen.open(page);
                // A real element, not `networkidle`: this app keeps Firestore
                // listeners open, so "idle" is a moving target.
                for (const ready of [screen.ready(page)].flat()) {
                    await expect(ready).toBeVisible({ timeout: 30_000 });
                }
                await settle(page);
                await expect(page).toHaveScreenshot(`${screen.name}-${label}.png`, {
                    ...SHOT,
                    fullPage: true,
                });
            });
        }
    }
});
