const { test, expect } = require('@playwright/test');
const { measureTables } = require('../scripts/table-layout/measureTables.cjs');
const { freezeClock, settle } = require('./visual/settle.cjs');

/**
 * @table-layout — a table cell contains what is put in it, on the application's
 * own screens.
 *
 * `npm run check:table-layout` holds the catalog to this rule. Catalog fixtures
 * are deliberately generic, so a pattern can pass there while the screen built
 * from it overflows on a longer real string or a narrower column: a two-word
 * header in an 88px column, a badge wider than its bucket. This runs the same
 * measurement (`scripts/table-layout/measureTables.cjs`) over every screen that
 * shows a table under the existing `?e2eAuth=` / `e2e…=mock` fixtures, at both
 * ends of the responsive range.
 *
 * Each screen names the text it waits for inside a table body before it
 * measures: `row`, a record the fixture shows, or `empty`, the empty or error
 * state it shows instead (in the table named `table`, when one is given). A
 * table's loading state (a "Loading…" row, skeleton rows) never counts as
 * loaded. Each screen must also measure at least one table. A column that
 * clips on purpose declares `truncate`, which the measurement exempts.
 *
 * Only the screens with a `row` have their cells measured on real records.
 * Those with `empty` have no records under the fixtures, so only their headers
 * and the empty or error row are measured; a screen moves to `row` when its
 * fixture gains records. A screen whose records come from a callable, which the
 * e2e build cannot reach, gets them from `callables`: the response that
 * callable returns, served in place of the network. A table behind a tab is
 * reached by `open`, which presses what a person would.
 *
 * Not covered, because no fixture renders the table without Firestore:
 * the import-leads preview (needs an uploaded file), the campaign results and
 * report (need a finished campaign), the stats backfill preview (needs a run),
 * and the dossier's own tables.
 */

// Two services as `getAiModelVersions` returns them (shape:
// `AiIntegrationsView.contract.support.jsx`), with the longest version ids and
// notes the card shows. Only the model versions table has rows: the provider
// list's callable is not served, so that table stays empty.
const AI_MODEL_VERSIONS = {
    autoSelect: true,
    running: false,
    lastRunAt: '2026-10-08T08:25:00.000Z',
    generatedAt: '2026-10-08T12:00:00.000Z',
    providers: [
        {
            id: 'gemini', displayName: 'Google Gemini', state: 'ready', account: null,
            checkedAt: '2026-10-08T08:25:00.000Z', reason: null,
            lanes: [
                { id: 'vision', status: 'ok', suggested: null, models: [{ id: 'gemini-3.7-flash', result: 'passed' }, { id: 'gemini-3.6-flash', result: 'busy' }] },
                { id: 'text', status: 'failing', suggested: ['gemini-3.5-flash'], models: [{ id: 'gemini-3.5-flash-lite', result: 'misread' }] },
            ],
        },
        {
            id: 'groq', displayName: 'Groq', state: 'not_set_up', account: null, checkedAt: null, reason: null,
            lanes: [
                { id: 'vision', status: 'unknown', suggested: null, models: [{ id: 'qwen/qwen3.8-27b', result: null }] },
                { id: 'text', status: null, suggested: null, models: [{ id: 'openai/gpt-oss-20b', result: null }] },
            ],
        },
    ],
};

const SCREENS = [
    { name: 'company dashboard leaderboard', url: '/company/dashboard?e2eAuth=company_admin', row: 'Jordan Recruiter' },
    { name: 'applications', url: '/company/drivers/applications?e2eAuth=company_admin', row: 'James McDonald' },
    { name: 'company leads', url: '/company/drivers/leads/company?e2eAuth=company_admin', row: 'Omar Attempt' },
    { name: 'my leads', url: '/company/drivers/leads/my?e2eAuth=company_admin', row: 'Lena Leadsen' },
    { name: 'unfinished applications', url: '/company/drivers/unfinished?e2eAuth=company_admin&e2eUnfinished=mock', row: 'Dana Whitfield' },
    {
        name: 'e-docs sent documents',
        url: '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock&e2eEdocSent=mock',
        open: (page) => page.getByRole('tab', { name: /^Sent Documents/ }).click(),
        row: 'Ana Lucia Ferreira-Montgomery',
    },
    { name: 'referral links', url: '/company/referral-links?e2eAuth=company_admin', empty: 'No referral links yet' },
    { name: 'settings api keys', url: '/company/settings?section=api_keys&e2eAuth=company_admin', empty: 'Unable to load records' },
    { name: 'super admin features', url: '/super-admin/features?e2eAuth=super_admin', empty: 'No companies yet' },
    { name: 'super admin companies', url: '/super-admin/companies?e2eAuth=super_admin', empty: 'No companies found.' },
    { name: 'super admin users', url: '/super-admin/users?e2eAuth=super_admin', empty: 'No users found.' },
    { name: 'super admin unified driver db', url: '/super-admin/applications?e2eAuth=super_admin', empty: 'No drivers match your filters.' },
    { name: 'super admin environment', url: '/super-admin/environment-integrations?e2eAuth=super_admin', empty: 'Unable to load records' },
    {
        name: 'super admin ai integrations',
        url: '/super-admin/ai-integrations?e2eAuth=super_admin',
        row: 'Google Gemini',
        table: 'AI model versions',
        callables: { getAiModelVersions: AI_MODEL_VERSIONS },
    },
    { name: 'super admin blog posts', url: '/super-admin/blog-posts?e2eAuth=super_admin', empty: 'No articles have been published yet.' },
    { name: 'super admin website leads', url: '/super-admin/website-leads?e2eAuth=super_admin', empty: 'No leads were captured.' },
];

const WIDTHS = [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'mobile', width: 412, height: 915 },
];

/** Answers each named callable with `result`, as the Functions endpoint would. */
async function serveCallables(page, callables) {
    const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
    };
    for (const [name, result] of Object.entries(callables)) {
        await page.route(`**/${name}`, (route) => (route.request().method() === 'OPTIONS'
            ? route.fulfill({ status: 204, headers: cors })
            : route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ result }) })));
    }
}

// Any table on the screen still loading: a busy `DataTable`, or a native
// table's "Loading…" row.
const STILL_LOADING = '.ds-data-table[aria-busy="true"], table.ds-native-table [role="status"]:has-text("Loading")';

test.describe('@table-layout application tables', () => {
    test.use({ locale: 'en-US', timezoneId: 'UTC' });
    test.describe.configure({ timeout: 90_000 });

    for (const { label, width, height } of WIDTHS) {
        for (const screen of SCREENS) {
            test(`${screen.name} @ ${label}`, async ({ page }) => {
                await page.setViewportSize({ width, height });
                await freezeClock(page);
                if (screen.callables) await serveCallables(page, screen.callables);
                await page.goto(screen.url);
                if (screen.open) await screen.open(page);
                // `table` names the one table the text must be in, where another
                // table on the screen could show the same text.
                const tables = screen.table ? page.getByRole('table', { name: screen.table }) : page.locator('table');
                await expect(tables.locator('tbody').getByText(screen.row ?? screen.empty).first())
                    .toBeAttached({ timeout: 30_000 });
                await expect(page.locator(STILL_LOADING)).toHaveCount(0, { timeout: 30_000 });
                await settle(page);

                const { findings, tableCount } = await page.evaluate(measureTables);
                expect(tableCount, 'the screen rendered no table to measure').toBeGreaterThan(0);
                expect(findings, `${screen.name} at ${width}px`).toEqual([]);
            });
        }
    }
});
