/**
 * The Hours of Service statement, in a real browser.
 *
 * A driver could not finish an application because the "last relieved from duty"
 * time was an `<input type="time">`: on a phone it can be set only through the
 * phone's own dialog, and theirs showed Clear and Cancel without Set. The time is
 * three lists now, and the hours are typed text that takes 7.25 and a decimal
 * comma. A driver off duty all week, a new one among them, says so once. This
 * walks the section the way a driver does, with nothing on it opening a picker
 * of the phone's own.
 *
 * The fixture company asks the statement only under `?e2eRules=hos`
 * (`buildE2EPublicProfile`), because no other spec answers it.
 */
const { test, expect } = require('@playwright/test');
const {
    applySignature,
    chooseRadio,
    continueAnywayPastEmploymentCoverage,
    continueToStep,
    expectStep,
    fillDateTriplet,
    fillStep1,
    fillStep2,
    fillStep3RequiredFields,
    submitApplication,
    uploadStandardDocuments,
} = require('./helpers/wizardHelpers.cjs');

/** From page one to General Questions, the same way every guest spec gets there. */
async function reachGeneralQuestions(page) {
    await page.goto('/apply/e2e-company?e2eRules=hos');
    await fillStep1(page);
    await fillStep2(page);
    await fillStep3RequiredFields(page);
    await uploadStandardDocuments(page);
    await continueToStep(page, 'Motor Vehicle Record');
    await chooseRadio(page, 'consent-mvr-yes');
    await chooseRadio(page, 'revoked-licenses-no');
    await chooseRadio(page, 'driving-convictions-no');
    await chooseRadio(page, 'drug-alcohol-convictions-no');
    await chooseRadio(page, 'has-violations-no');
    await continueToStep(page, 'Accident History');
    await chooseRadio(page, 'has-accidents-no');
    await continueToStep(page, 'Employment History');
    await continueAnywayPastEmploymentCoverage(page);
    await chooseRadio(page, 'has-felony-no');
}

/** Seven days of hours, the third typed with a comma, and yesterday as the date. */
async function answerHoursAndDate(page) {
    for (let n = 1; n <= 7; n += 1) {
        await page.fill(`#hos-day-${n}`, n === 3 ? '7,25' : '8');
    }
    await expect(page.locator('#hos-day-3')).toHaveValue('7.25');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await fillDateTriplet(page, 'hos-last-relieved-date', {
        month: yesterday.getMonth() + 1,
        day: yesterday.getDate(),
        year: yesterday.getFullYear(),
    });
}

test.describe('the Hours of Service statement', () => {
    test.describe.configure({ timeout: 90_000 });

    test('is answered without a picker of the phone’s own, and the application goes in', async ({ page }) => {
        await reachGeneralQuestions(page);
        await expect(page.getByText('Hours of Service Statement')).toBeVisible();
        await expect(page.locator('input[type="time"], input[type="date"], input[type="number"]')).toHaveCount(0);

        await answerHoursAndDate(page);
        await page.selectOption('#hos-last-relieved-time-hour', '6');
        await page.selectOption('#hos-last-relieved-time-minute', '30');
        await page.selectOption('#hos-last-relieved-time-period', 'PM');

        await continueToStep(page, 'Review Information');
        await page.getByRole('button', { name: 'Confirm & Proceed' }).click();
        await expectStep(page, 'Agreements & Signature');
        await applySignature(page);
        await submitApplication(page);
        await expect(page.getByText('Application Submitted!')).toBeVisible();
    });

    // A new driver has never been relieved from duty; a driver off duty all week
    // says so once, and the last relief is asked only if there is one.
    test('takes a week off duty without a last relief, and the application goes in', async ({ page }) => {
        await reachGeneralQuestions(page);
        await page.getByLabel('I was not on duty in the past 7 days').check();
        await expect(page.locator('#hos-day-1')).toHaveValue('0');
        await expect(page.locator('#hos-day-7')).toBeDisabled();

        await continueToStep(page, 'Review Information');
        await page.getByRole('button', { name: 'Confirm & Proceed' }).click();
        await expectStep(page, 'Agreements & Signature');
        await applySignature(page);
        await submitApplication(page);
        await expect(page.getByText('Application Submitted!')).toBeVisible();
    });

    test('holds the page on the minutes while the time is half chosen', async ({ page }) => {
        await reachGeneralQuestions(page);
        await answerHoursAndDate(page);
        await page.selectOption('#hos-last-relieved-time-hour', '9');
        await page.selectOption('#hos-last-relieved-time-period', 'AM');

        await page.getByRole('button', { name: 'Continue' }).click();
        await expectStep(page, 'General Questions');
        expect(await page.locator('#hos-last-relieved-time-minute').evaluate((list) => list.checkValidity())).toBe(false);

        await page.selectOption('#hos-last-relieved-time-minute', '05');
        await continueToStep(page, 'Review Information');
    });

    test('says what is wrong with hours over 24 and keeps the driver on the page', async ({ page }) => {
        await reachGeneralQuestions(page);
        await answerHoursAndDate(page);
        await page.fill('#hos-day-2', '25');
        await expect(page.getByText('Enter hours from 0 to 24, for example 7.5.')).toBeVisible();
        await page.selectOption('#hos-last-relieved-time-hour', '6');
        await page.selectOption('#hos-last-relieved-time-minute', '30');
        await page.selectOption('#hos-last-relieved-time-period', 'PM');

        await page.getByRole('button', { name: 'Continue' }).click();
        await expectStep(page, 'General Questions');
        await expect(page.locator('#hos-day-2')).toHaveAttribute('aria-invalid', 'true');
    });
});
