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
 * Each screen must measure at least one table: a screen whose table never
 * rendered is a broken setup, not a clean result. A column that clips on
 * purpose declares `truncate`, which the measurement exempts.
 *
 * Not covered, because no fixture renders the table without Firestore:
 * the import-leads preview (needs an uploaded file), the campaign results and
 * report (need a finished campaign), the stats backfill preview (needs a run),
 * and the dossier's own tables.
 */

const SCREENS = [
    { name: 'company dashboard leaderboard', url: '/company/dashboard?e2eAuth=company_admin' },
    { name: 'applications', url: '/company/drivers/applications?e2eAuth=company_admin' },
    { name: 'company leads', url: '/company/drivers/leads/company?e2eAuth=company_admin' },
    { name: 'my leads', url: '/company/drivers/leads/my?e2eAuth=company_admin' },
    { name: 'unfinished applications', url: '/company/drivers/unfinished?e2eAuth=company_admin&e2eUnfinished=mock' },
    { name: 'referral links', url: '/company/referral-links?e2eAuth=company_admin' },
    { name: 'settings api keys', url: '/company/settings?section=api_keys&e2eAuth=company_admin' },
    { name: 'super admin features', url: '/super-admin/features?e2eAuth=super_admin' },
    { name: 'super admin companies', url: '/super-admin/companies?e2eAuth=super_admin' },
    { name: 'super admin users', url: '/super-admin/users?e2eAuth=super_admin' },
    { name: 'super admin unified driver db', url: '/super-admin/applications?e2eAuth=super_admin' },
    { name: 'super admin environment', url: '/super-admin/environment-integrations?e2eAuth=super_admin' },
    { name: 'super admin ai integrations', url: '/super-admin/ai-integrations?e2eAuth=super_admin' },
    { name: 'super admin blog posts', url: '/super-admin/blog-posts?e2eAuth=super_admin' },
    { name: 'super admin website leads', url: '/super-admin/website-leads?e2eAuth=super_admin' },
];

const WIDTHS = [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'mobile', width: 412, height: 915 },
];

const TABLES = '.ds-data-table:not([aria-busy="true"]) th, table.ds-native-table th';

test.describe('@table-layout application tables', () => {
    test.use({ locale: 'en-US', timezoneId: 'UTC' });
    test.describe.configure({ timeout: 90_000 });

    for (const { label, width, height } of WIDTHS) {
        for (const screen of SCREENS) {
            test(`${screen.name} @ ${label}`, async ({ page }) => {
                await page.setViewportSize({ width, height });
                await freezeClock(page);
                await page.goto(screen.url);
                await expect(page.locator(TABLES).first()).toBeAttached({ timeout: 30_000 });
                await settle(page);

                const { findings, tableCount } = await page.evaluate(measureTables);
                expect(tableCount, 'the screen rendered no table to measure').toBeGreaterThan(0);
                expect(findings, `${screen.name} at ${width}px`).toEqual([]);
            });
        }
    }
});
