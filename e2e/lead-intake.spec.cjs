const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

/**
 * Real-browser evidence for the migrated lead-intake surfaces:
 * `/company/import-leads` (ImportLeadsPage + CompanyBulkUpload +
 * BulkUploadLayout) and `/company/quick-add-lead` (QuickAddLeadPage).
 *
 * Under `VITE_E2E_TEST_MODE=1` Firestore is unreachable, so everything up to and
 * including the confirm/save attempt is exercised; the committed write itself is
 * covered by the unit contract freezes instead. The parsing path is genuinely
 * real here — the CSV goes through the actual import Web Worker.
 *
 * All fixture data is artificial.
 */

const IMPORT_URL = '/company/import-leads?e2eAuth=company_admin';
const QUICK_ADD_URL = '/company/quick-add-lead?e2eAuth=company_admin';

const CSV = [
    'First Name,Last Name,Email,Phone,City,State,Experience,Job Type',
    'Artificial,ApplicantOne,one@example.test,(555) 000-0001,Dallas,TX,5,OTR',
    'Artificial,ApplicantTwo,two@example.test,(555) 000-0002,Austin,TX,3,Local',
].join('\n');

/** A CSV with more rows than the preview shows, to exercise the row cap. */
function largeCsv(rows) {
    const header = 'First Name,Last Name,Email,Phone,City,State,Experience,Job Type';
    const body = Array.from({ length: rows }, (_, i) => (
        `Artificial,Applicant${i},lead${i}@example.test,(555) 100-${String(i).padStart(4, '0')},`
        + `A very long city name used to exercise truncation ${i},TX,${i % 40},OTR`
    ));
    return [header, ...body].join('\n');
}

async function openImport(page) {
    await page.goto(IMPORT_URL);
    await expect(page.getByRole('heading', { level: 1, name: 'Import Leads' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Import Private Leads' })).toBeVisible();
}

async function uploadCsv(page, contents, name = 'artificial-leads.csv') {
    await page.locator('input[type="file"]').setInputFiles({
        name,
        mimeType: 'text/csv',
        buffer: Buffer.from(contents, 'utf8'),
    });
    await expect(page.getByText(/^Preview \(\d+ records\)$/)).toBeVisible({ timeout: 30_000 });
}

async function expectNoHorizontalOverflow(page, label) {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

/** No rendered interface text below the 12 px floor. */
async function undersizedText(page) {
    return page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
            if (!el.textContent || !el.textContent.trim()) continue;
            if (el.children.length > 0) continue;
            if (el.classList.contains('ds-visually-hidden')) continue;
            if (el.classList.contains('sr-only')) continue;
            const size = Number.parseFloat(getComputedStyle(el).fontSize);
            if (size && size < 12) out.push(`${el.tagName} ${size}px "${el.textContent.trim().slice(0, 30)}"`);
        }
        return out;
    });
}

/**
 * Serious/critical only, matching the project-wide convention in
 * `e2e/a11y.spec.cjs`: `meta-viewport` (moderate, from the app's
 * `maximum-scale=1` tag) is a pre-existing, app-wide condition on every route,
 * not something this campaign introduced or can fix from a feature slice.
 */
async function axeViolations(page) {
    const results = await new AxeBuilder({ page }).analyze();
    return results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
}

test.describe('Import Leads', () => {
    test.describe.configure({ timeout: 120_000 });

    test('renders the page shell embedded, not behind a modal overlay', async ({ page }) => {
        await openImport(page);

        // The pre-migration defect: a `fixed inset-0` overlay covered the page's
        // own header even though `isEmbedded` was passed.
        await expect(page.getByRole('dialog')).toHaveCount(0);

        const heading = page.getByRole('heading', { level: 1, name: 'Import Leads' });
        const box = await heading.boundingBox();
        const topElementIsHeading = await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            return Boolean(el && el.closest('h1'));
        }, { x: box.x + 4, y: box.y + box.height / 2 });
        expect(topElementIsHeading, 'the page heading is not covered').toBe(true);

        await expect(page.getByText('Bulk upload leads from a CSV file.')).toBeVisible();
    });

    test('shows the upload step with a real radio group and a reachable file input', async ({ page }) => {
        await openImport(page);

        const methods = page.getByRole('group', { name: 'Import method' });
        await expect(methods.getByRole('radio', { name: 'Upload File' })).toBeChecked();
        await expect(methods.getByRole('radio', { name: 'Google Sheet' })).not.toBeChecked();

        await expect(page.getByText('Instructions')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Download CSV Template' })).toBeVisible();

        const fileInput = page.locator('input[type="file"]');
        await expect(fileInput).toHaveAttribute('accept', '.csv,.xlsx,.xls');
        await fileInput.focus();
        await expect(fileInput).toBeFocused();
    });

    test('switches to the Google Sheet method and reports an invalid URL in place', async ({ page }) => {
        await openImport(page);

        await page.getByRole('radio', { name: 'Google Sheet' }).check();
        const url = page.getByRole('textbox', { name: 'Google Sheet URL' });
        await expect(url).toBeVisible();
        await expect(page.locator('input[type="file"]')).toHaveCount(0);

        // `exact: true`: a substring match against "Import" also matches the
        // dialog's "Close import" control.
        const importButton = page.getByRole('button', { name: 'Import', exact: true });
        await expect(importButton).toBeDisabled();
        await url.fill('https://example.test/not-a-sheet');
        await importButton.click();

        // Previously a blocking window.alert; now an in-page alert with the same text.
        await expect(page.getByRole('alert')).toHaveText('Invalid Google Sheet URL.');
    });

    test('parses a CSV through the real worker and previews it', async ({ page }) => {
        await openImport(page);
        await uploadCsv(page, CSV);

        await expect(page.getByText('Preview (2 records)')).toBeVisible();

        const table = page.getByRole('table', { name: 'Import preview' });
        await expect(table).toBeVisible();
        await expect(table.getByRole('columnheader', { name: 'firstName' })).toBeVisible();
        await expect(table.getByRole('columnheader', { name: 'phone', exact: true })).toBeVisible();
        // Internal fields are filtered out of the preview.
        await expect(table.getByRole('columnheader', { name: 'companyId' })).toHaveCount(0);
        await expect(table.getByRole('columnheader', { name: 'status' })).toHaveCount(0);

        await expect(table.getByText('ApplicantOne')).toBeVisible();
        await expect(table.getByText('ApplicantTwo')).toBeVisible();

        // Step meter reflects the move to Preview.
        const steps = page.getByRole('list', { name: 'Import steps' });
        await expect(steps.getByRole('listitem').nth(1)).toHaveAttribute('aria-current', 'step');
    });

    test('offers assignment modes and recipient selection on the preview step', async ({ page }) => {
        await openImport(page);
        await uploadCsv(page, CSV);

        const assignment = page.getByRole('group', { name: 'Lead Assignment' });
        await expect(assignment.getByRole('radio', { name: 'Unassigned (Pool)' })).toBeChecked();
        await expect(page.getByText('Select Recipients')).toHaveCount(0);

        await assignment.getByRole('radio', { name: 'Distribute to Team' }).check();
        await expect(page.getByText('Select Recipients')).toBeVisible();
        await expect(page.getByRole('button', { name: /^(Select All|Deselect All)$/ })).toBeVisible();
        await expect(page.getByText(/Leads will be distributed equally among the \d+ selected member/))
            .toBeVisible();
    });

    test('resets from the preview back to the upload step', async ({ page }) => {
        await openImport(page);
        await uploadCsv(page, CSV);

        await page.getByRole('button', { name: 'Reset' }).click();
        await expect(page.getByRole('group', { name: 'Import method' })).toBeVisible();
        await expect(page.getByText(/^Preview \(/)).toHaveCount(0);
    });

    test('caps a large preview at ten rows inside a bounded, labelled scroll region', async ({ page }) => {
        await openImport(page);
        await uploadCsv(page, largeCsv(300), 'artificial-large.csv');

        await expect(page.getByText('Preview (300 records)')).toBeVisible();

        const region = page.getByRole('region', { name: /Import preview\. Scroll horizontally/ });
        await expect(region).toHaveAttribute('tabindex', '0');

        const table = page.getByRole('table', { name: 'Import preview' });
        // 1 header row + 10 body rows.
        await expect(table.getByRole('row')).toHaveCount(11);

        const geometry = await region.evaluate((el) => ({
            height: el.getBoundingClientRect().height,
            scrollHeight: el.scrollHeight,
            canScroll: el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth,
        }));
        expect(geometry.height).toBeLessThanOrEqual(300);
        expect(geometry.canScroll).toBe(true);

        await expectNoHorizontalOverflow(page, 'large preview');
    });

    test('opens the data-repair confirmation as a real dialog and cancels with Escape', async ({ page }) => {
        await openImport(page);

        // If a native confirm() ever came back, this would hang the test rather
        // than pass silently.
        let nativeDialogs = 0;
        page.on('dialog', async (d) => { nativeDialogs += 1; await d.dismiss(); });

        await page.getByRole('button', { name: /Fix Data Mismatch/ }).click();

        const dialog = page.getByRole('dialog', { name: 'Fix Data Mismatch' });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(
            "This will scan your leads for 'Email' fields that look like Phone Numbers and move them to the correct field. Continue?",
        );
        await expect(dialog.getByRole('button', { name: 'Continue' })).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        expect(nativeDialogs).toBe(0);
    });

    test('cancels the data-repair confirmation with the Cancel button', async ({ page }) => {
        await openImport(page);
        await page.getByRole('button', { name: /Fix Data Mismatch/ }).click();

        const dialog = page.getByRole('dialog', { name: 'Fix Data Mismatch' });
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole('group', { name: 'Import method' })).toBeVisible();
    });

    test('reaches the upload control and the template with the keyboard alone', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name.startsWith('mobile'), 'Keyboard walkthrough is a desktop lane.');
        await openImport(page);

        const reached = new Set();
        for (let i = 0; i < 30; i += 1) {
            await page.keyboard.press('Tab');
            const focused = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el || el === document.body) return null;
                return {
                    tag: el.tagName,
                    type: el.getAttribute('type'),
                    text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
                };
            });
            if (!focused) continue;
            if (focused.type === 'file') reached.add('file');
            if (/Download CSV Template/.test(focused.text)) reached.add('template');
            if (/Fix Data Mismatch/.test(focused.text)) reached.add('repair');
            if (focused.type === 'radio') reached.add('method');
            if (reached.size === 4) break;
        }

        expect([...reached].sort()).toEqual(['file', 'method', 'repair', 'template']);
    });

    test('has no serious or critical axe violations across its states', async ({ page }) => {
        await openImport(page);
        expect(await axeViolations(page), 'upload step').toEqual([]);

        await page.getByRole('radio', { name: 'Google Sheet' }).check();
        expect(await axeViolations(page), 'google sheet method').toEqual([]);

        await page.getByRole('radio', { name: 'Upload File' }).check();
        await uploadCsv(page, CSV);
        expect(await axeViolations(page), 'preview step').toEqual([]);

        await page.getByRole('radio', { name: 'Distribute to Team' }).check();
        expect(await axeViolations(page), 'preview / round robin').toEqual([]);
    });

    test('has no axe violations with the repair dialog open', async ({ page }) => {
        await openImport(page);
        await page.getByRole('button', { name: /Fix Data Mismatch/ }).click();
        await expect(page.getByRole('dialog', { name: 'Fix Data Mismatch' })).toBeVisible();
        expect(await axeViolations(page)).toEqual([]);
    });

    for (const { label, width, height } of [
        { label: '1440', width: 1440, height: 900 },
        { label: '1024', width: 1024, height: 768 },
        { label: '412', width: 412, height: 915 },
    ]) {
        test(`fits ${label} px without document overflow or sub-12px text`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name.startsWith('mobile'), 'Explicit viewport sweep runs on the desktop lane.');
            await page.setViewportSize({ width, height });
            await openImport(page);

            await expectNoHorizontalOverflow(page, `${label} upload`);
            expect(await undersizedText(page), `${label} upload: text below 12px`).toEqual([]);

            await uploadCsv(page, CSV);
            await expectNoHorizontalOverflow(page, `${label} preview`);
            expect(await undersizedText(page), `${label} preview: text below 12px`).toEqual([]);

            await page.getByRole('radio', { name: 'Distribute to Team' }).check();
            await expectNoHorizontalOverflow(page, `${label} round robin`);
            expect(await undersizedText(page), `${label} round robin: text below 12px`).toEqual([]);
        });
    }

    test('stays usable on a mobile device lane', async ({ page }, testInfo) => {
        test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile device lane.');
        await openImport(page);

        await expectNoHorizontalOverflow(page, 'mobile upload');
        await uploadCsv(page, CSV);
        await expectNoHorizontalOverflow(page, 'mobile preview');
        expect(await undersizedText(page), 'mobile: text below 12px').toEqual([]);
        expect(await axeViolations(page), 'mobile preview axe').toEqual([]);
    });
});

test.describe('Quick Add Lead', () => {
    test.describe.configure({ timeout: 120_000 });

    test('labels every field and marks the required ones', async ({ page }) => {
        await page.goto(QUICK_ADD_URL);
        await expect(page.getByRole('heading', { level: 1, name: 'Quick Add Lead' })).toBeVisible();

        for (const label of [
            'First Name', 'Last Name', 'Phone', 'Email', 'City', 'State',
            'Years of Experience', 'CDL Class', 'Notes',
        ]) {
            await expect(
                page.getByLabel(new RegExp(`^${label}`)),
                `${label} has an accessible name`,
            ).toBeVisible();
        }

        for (const label of ['First Name', 'Last Name', 'Phone']) {
            await expect(page.getByLabel(new RegExp(`^${label}`)))
                .toHaveAttribute('aria-required', 'true');
        }
    });

    test('validates in the app, names the fields and focuses the first invalid one', async ({ page }) => {
        await page.goto(QUICK_ADD_URL);
        await page.getByRole('button', { name: 'Save Lead' }).click();

        await expect(page.getByText('First Name is required.')).toBeVisible();
        await expect(page.getByText('Last Name is required.')).toBeVisible();
        await expect(page.getByText('Phone is required.')).toBeVisible();
        await expect(page.getByLabel(/^First Name/)).toBeFocused();
        await expect(page.getByLabel(/^First Name/)).toHaveAttribute('aria-invalid', 'true');

        // The frozen toast wording, which was unreachable before `noValidate`.
        await expect(page.getByRole('alert').filter({
            hasText: 'Please fill in required fields (First Name, Last Name, Phone).',
        })).toBeVisible();
    });

    test('clears a field error when the field is corrected', async ({ page }) => {
        await page.goto(QUICK_ADD_URL);
        await page.getByRole('button', { name: 'Save Lead' }).click();
        await expect(page.getByText('Phone is required.')).toBeVisible();

        await page.getByLabel(/^Phone/).fill('(555) 000-0000');
        await expect(page.getByText('Phone is required.')).toHaveCount(0);
        await expect(page.getByLabel(/^Phone/)).not.toHaveAttribute('aria-invalid', 'true');
    });

    test('keeps the frozen CDL options and default', async ({ page }) => {
        await page.goto(QUICK_ADD_URL);
        const select = page.getByLabel(/^CDL Class/);
        await expect(select).toHaveValue('A');
        expect(await select.locator('option').allTextContents())
            .toEqual(['Class A', 'Class B', 'Class C', 'No CDL']);
    });

    test('completes the form by keyboard and locks the submit control once', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name.startsWith('mobile'), 'Keyboard walkthrough is a desktop lane.');
        await page.goto(QUICK_ADD_URL);

        await page.getByLabel(/^First Name/).focus();
        await page.keyboard.type('Artificial');
        await page.keyboard.press('Tab');
        await page.keyboard.type('Applicant');
        await page.getByLabel(/^Phone/).focus();
        await page.keyboard.type('(555) 000-0000');

        await expect(page.getByLabel(/^First Name/)).toHaveValue('Artificial');
        await expect(page.getByLabel(/^Last Name/)).toHaveValue('Applicant');

        await page.getByRole('button', { name: 'Save Lead' }).click();

        // Firestore is unreachable under VITE_E2E_TEST_MODE, so the write never
        // completes here — deliberately: what this asserts is that a submission
        // in flight cannot be submitted again, and that no validation error is
        // raised for a fully filled form. The committed payload is proven by
        // `QuickAddLeadPage.contract.test.jsx`.
        const saving = page.getByRole('button', { name: 'Saving...' });
        await expect(saving).toBeVisible();
        await expect(saving).toBeDisabled();
        await expect(saving).toHaveAttribute('aria-busy', 'true');

        await expect(page.getByText('First Name is required.')).toHaveCount(0);
        await expect(page).toHaveURL(/quick-add-lead/);
    });

    test('cancels back to the dashboard', async ({ page }) => {
        await page.goto(QUICK_ADD_URL);
        await page.getByRole('button', { name: 'Cancel' }).click();
        await expect(page).toHaveURL(/\/company\/dashboard/);
    });

    test('has no axe violations in the default and error states', async ({ page }) => {
        await page.goto(QUICK_ADD_URL);
        await expect(page.getByRole('heading', { level: 1, name: 'Quick Add Lead' })).toBeVisible();
        expect(await axeViolations(page), 'default').toEqual([]);

        await page.getByRole('button', { name: 'Save Lead' }).click();
        await expect(page.getByText('First Name is required.')).toBeVisible();
        expect(await axeViolations(page), 'validation errors').toEqual([]);
    });

    for (const { label, width, height } of [
        { label: '1440', width: 1440, height: 900 },
        { label: '1024', width: 1024, height: 768 },
        { label: '412', width: 412, height: 915 },
    ]) {
        test(`fits ${label} px without document overflow or sub-12px text`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name.startsWith('mobile'), 'Explicit viewport sweep runs on the desktop lane.');
            await page.setViewportSize({ width, height });
            await page.goto(QUICK_ADD_URL);
            await expect(page.getByRole('heading', { level: 1, name: 'Quick Add Lead' })).toBeVisible();

            await expectNoHorizontalOverflow(page, `${label} quick add`);
            expect(await undersizedText(page), `${label}: text below 12px`).toEqual([]);

            await page.getByRole('button', { name: 'Save Lead' }).click();
            await expect(page.getByText('First Name is required.')).toBeVisible();
            await expectNoHorizontalOverflow(page, `${label} quick add errors`);
        });
    }

    test('stays usable on a mobile device lane', async ({ page }, testInfo) => {
        test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile device lane.');
        await page.goto(QUICK_ADD_URL);
        await expect(page.getByRole('heading', { level: 1, name: 'Quick Add Lead' })).toBeVisible();

        await expectNoHorizontalOverflow(page, 'mobile quick add');
        expect(await undersizedText(page), 'mobile: text below 12px').toEqual([]);
        expect(await axeViolations(page), 'mobile quick add axe').toEqual([]);
    });
});
