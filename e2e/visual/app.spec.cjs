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
 *  - `/` — no page of its own: it sends a visitor to sign in or to their workspace.
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
    AI_TELEMETRY, API_KEYS, BACKFILL_PREVIEW, BLOG_POSTS, BLOG_RUNS, ENVIRONMENT_INVENTORY, SMS_OPT_OUTS, TEAM_ROSTER,
    WEBSITE_LEADS, serveCallables,
} = require('../helpers/callables.cjs');
const { uploadLeadFile } = require('../helpers/leadImport.cjs');
const { APPLY_SCREEN_CODE, holdRequests } = require('../helpers/holdRequest.cjs');

/** The dev server's URL for the app's entry module, the one script `index.html` loads. */
const APP_ENTRY = /\/src\/main\.jsx(\?.*)?$/;

/**
 * A screen is listed with the thing that must be on it before a screenshot is
 * meaningful — or, when parts of it load independently, every such thing.
 * Waiting on a real element rather than a network idle is what stops a baseline
 * capturing a half-rendered page — and what makes a genuine regression fail here
 * rather than produce a confusing diff.
 *
 * `before(page)`, optional, runs before the page opens and may return a hold
 * (`helpers/holdRequest.cjs`) that keeps a loading state on screen; the runner
 * releases it, and removes every route, when the test ends, even on a failure.
 */
const SCREENS = [
    {
        name: 'company-dashboard',
        url: '/company/dashboard?e2eAuth=company_admin',
        // The counts and the hiring brief load on their own, after the greeting.
        ready: (page) => [
            page.getByRole('heading', { name: 'Welcome back', exact: true }),
            page.getByRole('button', { name: 'Hired: 2' }),
            page.getByRole('link', { name: /^\d+ in process$/ }),
        ],
    },
    {
        name: 'company-candidate-list',
        url: '/company/drivers/applications?e2eAuth=company_admin',
        // A fixture row, so the count beside the heading has arrived too.
        ready: (page) => page.getByText('Maria Garcia'),
    },
    /*
     * The driver dossier on a loaded, made-up record (`e2eDossier=loaded`, the
     * same applicant whatever row opens it), opened from the list on the
     * driver's name: on a phone the middle of a row is its call button. On a
     * phone, Close, the name on one line and the section strip stay put above
     * the record. Each part that loads on its own is waited on: Do not text (in
     * the Summary's Contact card) once the opt-out check is answered here, the
     * DQ marker once its (empty) list arrives, and the Application tab's
     * summary, which it opens on.
     */
    {
        name: 'company-dossier-loaded',
        url: '/company/drivers/applications?e2eAuth=company_admin&e2eDossier=loaded',
        callables: { checkSmsOptOut: { listed: false } },
        // The name, not the middle of the cell, which now holds the phone number's button.
        open: (page) => page.getByRole('row', { name: 'Open driver dossier for Maria Garcia' })
            .getByRole('rowheader').getByText('Maria Garcia', { exact: true }).click(),
        ready: (page) => [
            page.getByRole('dialog', { name: 'Driver dossier' })
                .getByRole('heading', { level: 2, name: 'Maximiliano Alejandro Castellanos-Whitfield' }),
            page.getByRole('button', { name: /^Do not text / }),
            page.getByRole('tab', { name: /^DQ File.*incomplete/ }),
            page.getByRole('heading', { name: 'Clean Record' }),
        ],
    },
    {
        name: 'company-settings',
        url: '/company/settings?e2eAuth=company_admin',
        // The menu of sections, at every width.
        ready: (page) => page.getByRole('heading', { level: 1, name: 'Settings' }),
    },
    {
        name: 'company-settings-profile',
        url: '/company/settings?section=company&e2eAuth=company_admin',
        // Company profile beside the rail; on a phone, with its way back to the menu.
        ready: (page) => page.getByRole('heading', { level: 1, name: 'Company profile' }),
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
    /* The application's standard questions, a row of switches per field. */
    {
        name: 'company-settings-questions',
        url: '/company/settings?section=application&e2eAuth=company_admin',
        open: (page) => page.getByRole('tab', { name: 'Questions' }).click(),
        ready: (page) => page.getByRole('rowheader', { name: 'Signed MVR Authorization Form (upload)' }),
    },
    {
        name: 'company-settings-api-keys',
        url: '/company/settings?section=api_keys&e2eAuth=company_admin',
        // The keys come from a callable, answered here as the server would.
        callables: { listCompanyApiKeys: API_KEYS },
        ready: (page) => page.getByText('Artificial TMS'),
    },
    {
        name: 'company-settings-team',
        url: '/company/settings?section=team&e2eAuth=company_admin',
        // The roster comes from a callable, answered here as the server would.
        callables: { listCompanyTeam: TEAM_ROSTER },
        ready: (page) => page.getByText('Maria-Annunziata Delacroix-Whitfield'),
    },
    /*
     * SMS before it is set up: the checklist (Firestore is unreachable here), and
     * under it the opted-out numbers, which come from a callable answered here.
     */
    {
        name: 'company-settings-sms',
        url: '/company/settings?section=sms&e2eAuth=company_admin',
        callables: { listSmsOptOuts: SMS_OPT_OUTS },
        ready: (page) => [
            page.getByRole('heading', { level: 3, name: /^Connect RingCentral/ }),
            page.getByRole('button', { name: 'Remove (555) 555-0199' }),
        ],
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
    /*
     * The Activity section's two performance tables, with made-up figures
     * (`e2eAnalytics=mock`): without them the period has no calls and each
     * table shows only its empty message. Waits on the platform totals for the
     * reason given above. Pressing the tab scrolls the page to it, so the page
     * goes back to the top first: a full-page shot of a scrolled page draws the
     * sticky masthead where the viewport was, over the cards.
     */
    {
        name: 'super-admin-activity-companies',
        url: '/super-admin?e2eAuth=super_admin&e2eAnalytics=mock',
        open: (page) => openActivityTab(page, 'Company Performance'),
        ready: (page) => [
            page.getByText(/^(Platform totals loaded\.|\d+ of \d+ platform totals failed to load: .+\.)$/),
            page.getByRole('rowheader', { name: 'Sample Haulage' }),
        ],
    },
    {
        name: 'super-admin-activity-recruiters',
        url: '/super-admin?e2eAuth=super_admin&e2eAnalytics=mock',
        open: (page) => openActivityTab(page, 'Recruiter Stats'),
        ready: (page) => [
            page.getByText(/^(Platform totals loaded\.|\d+ of \d+ platform totals failed to load: .+\.)$/),
            page.getByRole('rowheader', { name: 'Riley Sample' }),
        ],
    },
    /*
     * Maintenance after a dry run of the stats backfill, answered with fourteen
     * made-up days (`BACKFILL_PREVIEW`), so the preview's 256px cap shows. The
     * page goes back to the top after the click, as for the Activity tabs.
     */
    {
        name: 'super-admin-backfill-preview',
        url: '/super-admin/maintenance?e2eAuth=super_admin',
        callables: { backfillCompanyStats: BACKFILL_PREVIEW },
        open: async (page) => {
            await page.getByLabel('Company ID').fill('e2e-company-artificial');
            await page.getByRole('button', { name: 'Dry-Run (Preview)' }).click();
            await page.getByRole('rowheader', { name: '2026-10-01' }).waitFor();
            await page.evaluate(() => window.scrollTo(0, 0));
        },
        ready: (page) => page.getByRole('rowheader', { name: '2026-10-01' }),
    },
    /* The companies list on three made-up companies (`e2eCompanies=mock`). */
    {
        name: 'super-admin-companies',
        url: '/super-admin/companies?e2eAuth=super_admin&e2eCompanies=mock',
        ready: (page) => page.getByRole('rowheader', { name: 'Northern Plains Refrigerated Transport Cooperative' }),
    },
    /* The users list on three made-up users and their companies (`e2eCompanies=mock`). */
    {
        name: 'super-admin-users',
        url: '/super-admin/users?e2eAuth=super_admin&e2eCompanies=mock',
        ready: (page) => page.getByRole('rowheader', { name: /^Alexandra Montgomery-Okonkwo/ }),
    },
    /* The Unified Driver Database on three made-up drivers (`e2eCompanies=mock`). */
    {
        name: 'super-admin-driver-database',
        url: '/super-admin/applications?e2eAuth=super_admin&e2eCompanies=mock',
        ready: (page) => page.getByRole('rowheader', { name: /^Ana Lucia Ferreira-Montgomery/ }),
    },
    /* A made-up company's Features tab, one switch-off scheduled (`e2eCompanies=mock`). */
    {
        name: 'super-admin-company-features',
        url: '/super-admin/companies/e2e-co-1?e2eAuth=super_admin&e2eCompanies=mock',
        ready: (page) => page.getByRole('rowheader', { name: 'Facebook leads' }),
    },
    /*
     * A company's applications dialog, opened from the companies table on made-up
     * companies and drivers (`e2eCompanies=mock`). Opened by keyboard: on a phone
     * the table scrolls sideways under its pinned name column. Focusing the
     * button scrolls the page, so it goes back to the top, as for the Activity tabs.
     */
    {
        name: 'super-admin-company-applications',
        url: '/super-admin/companies?e2eAuth=super_admin&e2eCompanies=mock',
        open: async (page) => {
            await page.getByRole('button', { name: 'View applications for Artificial Freight Lines' }).focus();
            await page.keyboard.press('Enter');
            await page.getByRole('dialog').getByRole('rowheader', { name: /^Ana Lucia Ferreira-Montgomery/ }).waitFor();
            await page.evaluate(() => window.scrollTo(0, 0));
        },
        ready: (page) => page.getByRole('dialog').getByRole('rowheader', { name: /^Ana Lucia Ferreira-Montgomery/ }),
    },
    /*
     * A finished campaign (`e2eCampaign=mock`): its recipient log under Details,
     * the campaign's one report screen. Twelve made-up recipients, so the capped
     * table scrolls. Details scrolls inside its own panel, below the masthead, so
     * the shot brings the log into view there; the window does not move.
     */
    {
        name: 'company-campaign-results',
        url: '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock',
        open: async (page) => {
            await page.getByRole('tab', { name: /Sent & live/i }).click();
            await page.getByRole('button', { name: /^Details$/i }).first().click();
            await page.getByRole('rowheader', { name: 'E2E Recipient 1', exact: true }).waitFor();
            // Only the panel that scrolls moves: `scrollIntoView` would also shift the
            // app shell, uncovering the skip link parked above its top edge.
            await page.getByRole('heading', { name: 'Recipient Log' }).evaluate((heading) => {
                let panel = heading.parentElement;
                while (panel && !/(auto|scroll)/.test(getComputedStyle(panel).overflowY)) panel = panel.parentElement;
                if (panel) panel.scrollTop += heading.getBoundingClientRect().top - panel.getBoundingClientRect().top;
            });
        },
        ready: (page) => page.getByRole('rowheader', { name: 'E2E Recipient 1', exact: true }),
    },
    {
        name: 'login',
        url: '/login',
        ready: (page) => page.getByRole('button', { name: /Sign In/i }),
    },
    {
        name: 'public-application',
        url: '/apply/e2e-company',
        // The wizard's own heading, never the loading placeholder's hidden one.
        ready: (page) => page.getByRole('heading', { level: 1, name: /^Step 1 of \d+:/ }),
    },
    {
        // The screen's code is held, so the placeholder stays; the screenshot's
        // `animations: 'disabled'` stops its pulse on the first frame.
        name: 'public-application-loading',
        url: '/apply/e2e-company?e2eIntake=choice',
        before: (page) => holdRequests(page, APPLY_SCREEN_CODE),
        ready: (page) => page.getByRole('main', { name: 'Loading Application...' }),
    },
    {
        /*
         * `index.html` alone, as a phone paints it while the app's code
         * downloads: the start-up splash, the same on every route. The entry is
         * refused, not held, because a held module script holds the page's
         * `load` and `goto` with it. The dev server injects styles from that
         * script, so the stylesheet is linked as the build links it in `<head>`.
         */
        name: 'page-shell',
        url: '/apply/e2e-company',
        // Returns nothing: `page.route` resolves to a Disposable, not a hold.
        before: async (page) => { await page.route(APP_ENTRY, (route) => route.abort()); },
        open: (page) => page.addStyleTag({ url: '/src/index.css' }),
        ready: (page) => page.locator('#startup-splash'),
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

/** Presses one of the Activity section's tabs, then puts the page back at the top. */
async function openActivityTab(page, name) {
    await page.getByRole('tab', { name }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
}

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
                const hold = screen.before ? await screen.before(page) : null;
                try {
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
                } finally {
                    // A held request must never outlive its test.
                    // Only a hold (`helpers/holdRequest.cjs`) has `release`.
                    if (typeof hold?.release === 'function') await hold.release();
                    await page.unrouteAll({ behavior: 'ignoreErrors' });
                }
            });
        }
    }
});
