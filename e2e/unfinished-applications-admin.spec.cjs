/**
 * A Company Admin's own powers in the unfinished-applications workspace.
 *
 * The owner decided on 2026-10-06 that a Company Admin reads every unfinished
 * application — read-only where the driver has written — and may delete any of
 * them. The worklist comes from its `e2eUnfinished=mock` fixture; the two
 * callables behind these actions are answered here, at the network, because an
 * E2E run points at an unreachable Firebase project on purpose. What a browser
 * proves that the unit suites cannot: the dialog's focus and Escape, and that
 * the screens hold together on a real page.
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

    test('deleting asks first, and the row leaves the list', async ({ page }) => {
        await stubCallable(page, 'deleteApplicationDraft', { deleted: true, applicantKey: 'aaaa1111bbbb2222cccc' });
        await page.goto(START_URL);
        const remove = page.getByRole('button', { name: /Delete the application for Dana Whitfield/i });

        await remove.click();
        const dialog = page.getByRole('dialog', { name: 'Delete this unfinished application?' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Keep application' })).toBeFocused();
        // Escape is a change of mind, never a deletion.
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(remove).toBeFocused();

        await remove.click();
        await dialog.getByRole('button', { name: 'Delete application' }).click();

        await expect(page.getByText('Deleted the unfinished application for Dana Whitfield.')).toBeVisible();
        // The row's own control, not the name: the sentence above names her too.
        await expect(page.getByRole('button', { name: /Open the application for Dana Whitfield/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Open the application for Marcus Iyer/i })).toBeVisible();
    });

    test('the read-only view and the delete confirmation pass axe @a11y', async ({ page }) => {
        await stubCallable(page, 'getApplicationDraft', DRAFT_VIEW);
        await page.goto(START_URL);

        await page.getByRole('button', { name: /Delete the application for Dana Whitfield/i }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await seriousViolations(page)).toEqual([]);
        await page.getByRole('button', { name: 'Keep application' }).click();

        await page.getByRole('button', { name: /Open the application for Dana Whitfield/i }).click();
        await expect(page.getByText('D9988776')).toBeVisible();
        expect(await seriousViolations(page)).toEqual([]);
    });
});
