/**
 * The driver's CDL photo auto-fill — "Upload CDL for Auto-Fill (Fastest)", the
 * first thing the public application offers — and what it puts on screen.
 *
 * It had no browser test at all, and the one defect it carried only a browser
 * shows: a licence prints its state as a postal code ("TX"), the auto-fill wrote
 * that code into both state pickers, and the pickers list names. Given a value
 * with no option, Chromium selected the first one it could, so a driver with an
 * Austin address saw "Alabama" twice while the form held "TX" — and the step's
 * validation passed, because the field was not empty (found 2026-10-01, in a real
 * browser against the real Cloud Functions).
 *
 * The three calls the auto-fill makes are stubbed at the network edge, the way
 * `company-settings-integrations.spec.cjs` stubs the Facebook SDK: reserving the
 * upload path, the Storage upload itself, and the AI parser's reply. Everything
 * after the reply is the product.
 */
const { test, expect } = require('@playwright/test');
const { chooseRadio, continueToStep, expectStep, fillStep2 } = require('./helpers/wizardHelpers.cjs');

const STORAGE_PATH = 'companies/e2e-company/autofill/guest_uploads/1_cdl.jpg';

async function stubAutoFillNetwork(page) {
    await page.route('**/getSignedUploadUrl', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: { storagePath: STORAGE_PATH } }),
    }));
    await page.route('https://firebasestorage.googleapis.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            name: STORAGE_PATH,
            bucket: 'safehaul-e2e.appspot.com',
            generation: '1',
            metageneration: '1',
            contentType: 'image/jpeg',
            size: '22',
            timeCreated: '2026-10-01T00:00:00.000Z',
            updated: '2026-10-01T00:00:00.000Z',
        }),
    }));
    await page.route('**/parseCdlWithGroq', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: { fields: {
            firstName: 'LUIS',
            lastName: 'ORTEGA',
            dateOfBirth: '03/14/1984',
            fullAddress: '2210 ELM ST, AUSTIN, TX 78701',
            cdlNumber: '41234567',
            expirationDate: '03/14/2030',
        } } }),
    }));
}

test.describe('CDL photo auto-fill', () => {
    test('fills both state pickers with the state the licence printed', async ({ page }) => {
        await stubAutoFillNetwork(page);
        // `e2eIntake=choice` shows the chooser, as `guest-application-intake.spec.cjs` does.
        await page.goto('/apply/e2e-company?e2eIntake=choice');
        await expect(page.getByRole('button', { name: /Upload CDL for Auto-Fill/ })).toBeVisible();

        await page.locator('input[type="file"]').first().setInputFiles({
            name: 'cdl.jpg',
            mimeType: 'image/jpeg',
            buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]),
        });

        await expectStep(page, 'Personal Information');
        await expect(page.locator('#first-name')).toHaveValue('LUIS');
        await expect(page.locator('#city')).toHaveValue('AUSTIN');
        await expect(page.locator('#state')).toHaveValue('Texas');
        await expect(page.locator('#state option:checked')).toHaveText('Texas');

        await page.fill('#ssn', '123-45-6789');
        await page.fill('#phone', '5125550142');
        await page.fill('#email', 'luis.ortega@example.com');
        await chooseRadio(page, 'sms-consent-yes');
        await chooseRadio(page, 'residence-3-years-yes');
        await continueToStep(page, 'Qualification');
        await fillStep2(page);

        await expectStep(page, 'License');
        await expect(page.locator('#cdl-state')).toHaveValue('Texas');
        await expect(page.locator('#cdl-state option:checked')).toHaveText('Texas');
        await expect(page.locator('#cdl-number')).toHaveValue('41234567');
    });
});
