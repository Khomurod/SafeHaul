/**
 * The applicant's signature, drawn in a real browser.
 *
 * It was kept only once the driver pressed Save Signature, so a driver who drew
 * and went on found Submit grey and no reason given; and after Back the page said
 * the signature was saved over an empty pad. Each stroke saves as it ends now,
 * Clear is always there, the signature is drawn back when its page is shown
 * again, and a line names what still keeps Submit grey.
 */
const { test, expect } = require('@playwright/test');
const {
    acceptAgreements,
    completeRemainingSteps,
    continueToStep,
    fillStep1,
    fillStep2,
    fillStep3RequiredFields,
    uploadStandardDocuments,
} = require('./helpers/wizardHelpers.cjs');

async function reachSignaturePage(page) {
    await page.goto('/apply/e2e-company');
    await fillStep1(page);
    await fillStep2(page);
    await fillStep3RequiredFields(page);
    await uploadStandardDocuments(page);
    await continueToStep(page, 'Motor Vehicle Record');
    await completeRemainingSteps(page);
    await acceptAgreements(page);
}

/**
 * One stroke across the pad: with a finger on a touch device (touch events, sent
 * through the browser's own input layer), with the mouse elsewhere.
 */
async function drawOnPad(page) {
    const pad = page.locator('#signature-canvas');
    await pad.scrollIntoViewIfNeeded();
    const box = await pad.boundingBox();
    const points = [
        [box.x + 20, box.y + box.height / 2],
        [box.x + 60, box.y + 40],
        [box.x + 100, box.y + 30],
        [box.x + 140, box.y + box.height - 40],
        [box.x + 180, box.y + box.height - 30],
    ];
    if (test.info().project.use?.hasTouch) {
        const cdp = await page.context().newCDPSession(page);
        const touch = (type, [x, y]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
        await touch('touchStart', points[0]);
        for (const point of points.slice(1)) await touch('touchMove', point);
        await touch('touchEnd', points[points.length - 1]);
        return;
    }
    await page.mouse.move(...points[0]);
    await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(...point, { steps: 4 });
    await page.mouse.up();
}

const padHasInk = (page) => page.locator('#signature-canvas').evaluate((canvas) => (
    canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value) => value !== 0)
));

test.describe('the applicant signature', () => {
    test.describe.configure({ timeout: 90_000 });

    test('counts the moment a stroke ends, and is still there after Back', async ({ page }) => {
        await reachSignaturePage(page);
        const submit = page.getByRole('button', { name: 'Submit Full Application' });
        await expect(page.getByText('To submit, draw your signature in the box above and tick “I Certify and Agree”.')).toBeVisible();
        await expect(page.getByRole('button', { name: /Save Signature/ })).toHaveCount(0);

        await drawOnPad(page);
        await expect(page.getByText('Signature saved')).toBeVisible();
        await page.check('#final-certification');
        await expect(submit).toBeEnabled();

        await page.getByRole('button', { name: 'Back' }).click();
        await page.getByRole('button', { name: 'Continue to signature' }).click();
        await expect(page.getByText('Signature saved')).toBeVisible();
        await expect.poll(() => padHasInk(page)).toBe(true);
        await expect(submit).toBeEnabled();

        await page.getByRole('button', { name: 'Clear signature' }).click();
        await expect.poll(() => padHasInk(page)).toBe(false);
        await expect(submit).toBeDisabled();
        await expect(page.getByText('To submit, draw your signature in the box above.')).toBeVisible();
    });

    test('a drawn signature goes in with the application', async ({ page }) => {
        await reachSignaturePage(page);
        await drawOnPad(page);
        await page.check('#final-certification');
        await page.getByRole('button', { name: 'Submit Full Application' }).click();
        await expect(page.getByText('Application Submitted!')).toBeVisible();
    });
});
