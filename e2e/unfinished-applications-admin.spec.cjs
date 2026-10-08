/**
 * A Company Admin's own powers in the unfinished-applications workspace.
 *
 * The owner decided on 2026-10-06 that a Company Admin reads every unfinished
 * application, corrects the ones the driver owns, and may delete any of them. The worklist comes from its `e2eUnfinished=mock` fixture; the
 * callables behind these actions are answered here, at the network, because an
 * E2E run points at an unreachable Firebase project on purpose. What a browser
 * proves that the unit suites cannot: the dialog's focus and Escape, the list as
 * cards on a phone with nothing past the screen's edge, and that the screens hold
 * together on a real page.
 */
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const START_URL = '/company/drivers/unfinished?e2eAuth=company_admin&e2eUnfinished=mock';

/** Serious and critical axe violations on the page, by rule and node. */
async function seriousViolations(page) {
    const { violations } = await new AxeBuilder({ page }).analyze();
    return violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} [${v.impact}]: ${v.nodes.map((node) => node.target.join(' ')).join('; ')}`);
}

/** Answers one callable as Firebase's protocol does, so the screen behind it can be driven. */
async function stubCallable(page, name, result) {
    await page.route(`**/${name}`, (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ result }),
    }));
}

/**
 * Answers `purgeApplicationDraft` as the server does: what would go for a preview,
 * the deletion otherwise. Dana's preview names the fixture's nameless row as the
 * same driver's, by phone. Returns the requests, to assert what was confirmed.
 */
async function stubPurge(page) {
    const asked = [];
    await page.route('**/purgeApplicationDraft', (route) => {
        if (route.request().method() !== 'POST') {
            return route.fulfill({
                status: 204,
                headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' },
            });
        }
        const { data } = route.request().postDataJSON();
        asked.push(data);
        const result = data.preview
            ? {
                application: { applicantKey: data.applicantKey, firstName: 'Dana', lastName: 'Whitfield', fileCount: 2 },
                related: [{
                    applicantKey: 'bbbb5555cccc6666dddd', origin: 'driver', status: 'in_progress',
                    email: 'starter@example.test', lastSemanticStep: 'contact', lastStep: 0, fileCount: 0, shares: ['phone'],
                }],
            }
            : { deleted: [data.applicantKey, ...data.alsoDelete], skipped: [], files: { deleted: 2, kept: 0, failed: 0 } };
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ result }),
        });
    });
    return asked;
}

/** What `getApplicationDraft` returns for the worklist fixture's Dana Whitfield. */
const DRAFT_VIEW = {
    applicantKey: 'aaaa1111bbbb2222cccc',
    origin: 'driver',
    status: 'in_progress',
    firstName: 'Dana',
    lastName: 'Whitfield',
    lastSemanticStep: 'license',
    lastStep: 2,
    updatedAt: '2026-06-14T16:45:00.000Z',
    record: {
        frozen: true,
        schemaVersion: 1,
        submittedAt: null,
        provenance: { source: 'draft', notes: [] },
        sections: [
            {
                id: 'license',
                title: 'License & Credentials',
                answers: [{ fieldId: 'cdlNumber', label: 'License Number', type: 'text', presented: true, value: 'D9988776', displayValue: 'D9988776' }],
            },
            {
                id: 'documents',
                title: 'Required Documents',
                answers: [{
                    fieldId: 'cdl-front', label: 'CDL (Front)', type: 'file', presented: true,
                    value: { name: 'front.jpg', storagePath: 'companies/e2e-company/applications/guest_uploads/1_front.jpg' },
                    displayValue: 'front.jpg',
                }],
            },
        ],
        customAnswers: [{ questionId: 'q1', label: 'Willing to run a dedicated lane?', value: 'Yes', displayValue: 'Yes' }],
        agreements: [],
        employmentCoverage: null,
        signature: null,
    },
};

/** The same draft as the editor loads it: the driver owns it, so it may be edited. */
const EDITABLE_VIEW = {
    ...DRAFT_VIEW,
    editable: true,
    answers: { firstName: 'Dana', city: 'Austin', cdlNumber: 'D9988776' },
    lockedEmployers: [],
    form: { applicationConfig: {}, applicationRules: null, customQuestions: [] },
    companyRevision: 0,
    companyEdits: {},
    companyEditedAt: null,
};

test.describe('a Company Admin and an unfinished application', () => {
    test.describe.configure({ timeout: 90_000 });

    test('a Company Admin reads a driver’s unfinished application, read-only', async ({ page }) => {
        await stubCallable(page, 'getApplicationDraft', DRAFT_VIEW);
        await page.goto(START_URL);

        await page.getByRole('button', { name: /Open the application for Dana Whitfield/i }).click();

        await expect(page.getByRole('heading', { level: 1, name: 'Dana Whitfield' })).toBeVisible();
        await expect(page.getByText('D9988776')).toBeVisible();
        await expect(page.getByText('Willing to run a dedicated lane?')).toBeVisible();
        await expect(page.getByText(/never saved before the driver submits/)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Open file (opens in a new tab)' })).toBeVisible();
        await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);

        await page.getByRole('button', { name: /Back to unfinished applications/i }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Unfinished applications' })).toBeVisible();
    });

    test('deleting asks first, says what goes, and the row leaves the list', async ({ page }) => {
        const asked = await stubPurge(page);
        await page.goto(START_URL);
        const remove = page.getByRole('button', { name: /Delete everything for Dana Whitfield/i });

        await remove.click();
        const dialog = page.getByRole('dialog', { name: 'Delete this unfinished application?' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Keep application' })).toBeFocused();
        await expect(dialog.getByText('Everything saved for Dana Whitfield will be deleted for good: its answers, 2 uploaded files and any link sent for it.'))
            .toBeVisible();
        // Escape is a change of mind, never a deletion.
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(remove).toBeFocused();

        await remove.click();
        // The same driver's other application is ticked; this one is somebody else's.
        const other = dialog.getByRole('checkbox', { name: 'Name not entered yet' });
        await expect(other).toBeChecked();
        await other.uncheck();
        await dialog.getByRole('button', { name: 'Delete application' }).click();

        await expect(page.getByText('Deleted the unfinished application for Dana Whitfield.')).toBeVisible();
        expect(asked.at(-1)).toEqual({ companyId: 'e2e-company', applicantKey: 'aaaa1111bbbb2222cccc', alsoDelete: [] });
        // The row's own control, not the name: the sentence above names her too.
        await expect(page.getByRole('button', { name: /Open the application for Dana Whitfield/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Open the application for Marcus Iyer/i })).toBeVisible();
    });

    test('the list sums itself up, and the filters and the search narrow it', async ({ page }) => {
        await page.goto(START_URL);
        const table = page.getByRole('table', { name: 'Unfinished applications' });
        const rowNames = () => table.getByRole('rowheader').locator('span').first();

        await expect(page.getByRole('heading', { level: 2, name: '6 unfinished' })).toBeVisible();
        await expect(page.getByText('1 almost done · 2 with no activity for a week or more')).toBeVisible();
        await expect(table.getByRole('rowheader')).toHaveCount(6);

        await page.getByRole('button', { name: 'No activity for a week 2' }).click();
        await expect(table.getByRole('rowheader')).toHaveCount(2);
        await expect(page.getByText('Showing 2 of 6')).toBeVisible();
        await expect(rowNames()).toHaveText('Name not entered yet');

        await page.getByRole('searchbox', { name: 'Search by name, phone or email' }).fill('jordan');
        await expect(table.getByRole('rowheader')).toHaveCount(1);
        await expect(table.getByText('Removed in 4 days')).toBeVisible();

        await page.getByRole('button', { name: 'All 6' }).click();
        await page.getByRole('searchbox', { name: 'Search by name, phone or email' }).fill('+1 (555) 010-44');
        await expect(table.getByRole('rowheader')).toHaveCount(1);
        await expect(table.getByText('Marcus Iyer')).toBeVisible();
    });

    test('on a phone each application is a card, with a call, its link and its actions, inside the screen', async ({ page }) => {
        await page.setViewportSize({ width: 412, height: 915 });
        await page.goto(START_URL);

        const call = page.getByRole('link', { name: 'Call Dana Whitfield at (555) 010-2233' });
        await expect(call).toBeVisible();
        await expect(call).toHaveAttribute('href', 'tel:+15550102233');
        for (const name of ['Copy link', 'Open the application', 'Edit answers', 'Delete everything']) {
            await expect(page.getByRole('button', { name: `${name} for Dana Whitfield` })).toBeVisible();
        }
        // A card's values sit under their column's name, which the table's header
        // no longer shows.
        const card = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^Dana Whitfield/ }) });
        await expect(card.getByRole('cell').first()).toHaveAttribute('data-label', 'How far they got');
        // Inside the screen, measured where it could spill: the workspace clips its
        // own overflow, so the page's width would never show a card wider than it.
        const spill = await page.evaluate(() => {
            const region = document.querySelector('.ds-data-table__scroll-region');
            const tooWide = [...document.querySelectorAll('.ds-data-table tbody > tr, .ds-data-table tbody > tr > *')]
                .filter((element) => element.scrollWidth > element.clientWidth + 1
                    || element.getBoundingClientRect().right > region.getBoundingClientRect().right + 1)
                .map((element) => element.getAttribute('data-label') || element.tagName);
            return { scrolls: region.scrollWidth > region.clientWidth + 1, tooWide };
        });
        expect(spill).toEqual({ scrolls: false, tooWide: [] });
        expect(await seriousViolations(page)).toEqual([]);
    });

    test('Edit answers on the list opens the editor', async ({ page }) => {
        await stubCallable(page, 'getApplicationDraft', EDITABLE_VIEW);
        await page.goto(START_URL);

        await page.getByRole('button', { name: 'Edit answers for Dana Whitfield' }).click();

        await expect(page.getByRole('heading', { level: 1, name: 'Dana Whitfield' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
        await expect(page.getByLabel('City', { exact: true })).toHaveValue('Austin');
    });

    test('a Company Admin corrects an answer, and only that answer is sent', async ({ page }) => {
        await stubCallable(page, 'getApplicationDraft', EDITABLE_VIEW);
        const sent = [];
        await page.route('**/saveApplicationDraftEdits', (route) => {
            sent.push(route.request().postDataJSON().data);
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ result: {
                    ...EDITABLE_VIEW,
                    answers: { ...EDITABLE_VIEW.answers, city: 'Dallas' },
                    companyRevision: 1791300000000,
                    companyEdits: { city: 1791300000000 },
                    companyEditedAt: '2026-06-15T10:00:00.000Z',
                    changed: ['city'],
                    revision: 1791300000000,
                } }),
            });
        });
        await page.goto(START_URL);
        await page.getByRole('button', { name: /Open the application for Dana Whitfield/i }).click();

        await page.getByRole('button', { name: 'Edit answers' }).click();
        const save = page.getByRole('button', { name: 'Save changes' });
        await expect(save).toBeDisabled();
        await page.getByLabel('City', { exact: true }).fill('Dallas');
        await save.click();

        await expect(page.getByText('Changes saved')).toBeVisible();
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
            applicantKey: 'aaaa1111bbbb2222cccc',
            changes: { city: 'Dallas' },
            base: { city: 'Austin' },
        });
        await expect(page.getByRole('button', { name: 'Edit answers' })).toBeVisible();
    });

    test('the editor, an employer the company locked included, passes axe @a11y', async ({ page }) => {
        const acme = { companyName: 'Acme Trucking', dotNumber: '123456' };
        await stubCallable(page, 'getApplicationDraft', {
            ...EDITABLE_VIEW,
            answers: { ...EDITABLE_VIEW.answers, employers: [acme, { companyName: 'Blue Line' }] },
            lockedEmployers: [{ signature: 'dot:123456', ...acme }],
        });
        await page.goto(START_URL);
        await page.getByRole('button', { name: /Open the application for Dana Whitfield/i }).click();
        await page.getByRole('button', { name: 'Edit answers' }).click();
        await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
        await expect(page.getByText('Locked by your company')).toBeVisible();

        expect(await seriousViolations(page)).toEqual([]);
    });

    test('the list, the read-only view and the delete confirmation pass axe @a11y', async ({ page }) => {
        await stubCallable(page, 'getApplicationDraft', DRAFT_VIEW);
        await stubPurge(page);
        await page.goto(START_URL);
        await expect(page.getByRole('heading', { level: 2, name: '6 unfinished' })).toBeVisible();
        expect(await seriousViolations(page)).toEqual([]);

        await page.getByRole('button', { name: /Delete everything for Dana Whitfield/i }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await seriousViolations(page)).toEqual([]);
        await page.getByRole('button', { name: 'Keep application' }).click();

        await page.getByRole('button', { name: /Open the application for Dana Whitfield/i }).click();
        await expect(page.getByText('D9988776')).toBeVisible();
        expect(await seriousViolations(page)).toEqual([]);
    });
});
