/**
 * A driver opening the link their carrier sent them.
 *
 * The half of this feature that only a real browser can prove: the carrier's
 * answers are on screen before the driver types anything, and the employer the
 * carrier locked from a PSP report is a record rather than a field — while the
 * dates beside it, which the report never contained, are still the driver's to
 * fill in.
 *
 * The exchange is served by the fixture in `applicationDraftService.js`, gated on
 * the E2E flag and refused outright in a production build, for the same reason
 * the resume fixture is: an E2E run points at an unreachable Firebase project on
 * purpose, so a flow that lives behind a callable is otherwise unreachable.
 */
const { test, expect } = require('@playwright/test');
const {
    chooseRadio, continueToStep, expectStep, fillStep2, fillStep3RequiredFields,
} = require('./helpers/wizardHelpers.cjs');


const INVITE_URL = '/apply/e2e-company?invite=e2e-invite-token&k=e2e-applicant-key';

test.describe('an application a carrier prepared', () => {
    test('opens with the answers already filled in', async ({ page }) => {
        await page.goto(INVITE_URL);

        await expectStep(page, 'Personal Information');
        await expect(page.locator('#first-name')).toHaveValue('Prepared');
        await expect(page.locator('#last-name')).toHaveValue('Driver');
        await expect(page.locator('#email')).toHaveValue('prepared@example.com');
        await expect(page.locator('#city')).toHaveValue('Austin');
        // Never in a draft, so never pre-filled however much the carrier knows.
        await expect(page.locator('#ssn')).toHaveValue('');
    });

    test('shows a locked employer as a record, and leaves its dates to the driver', async ({ page }) => {
        await page.goto(INVITE_URL);
        await expectStep(page, 'Personal Information');

        // The carrier filled in the pages before employment, so the driver walks
        // through them — which is also the point: nothing was skipped for them,
        // and the Social Security Number a draft never stores is still asked for.
        await page.fill('#ssn', '123-45-6789');
        await chooseRadio(page, 'sms-consent-yes');
        await chooseRadio(page, 'residence-3-years-yes');
        await continueToStep(page, 'Qualification');
        await fillStep2(page);
        await fillStep3RequiredFields(page);
        await continueToStep(page, 'Motor Vehicle Record');
        await chooseRadio(page, 'consent-mvr-yes');
        await chooseRadio(page, 'revoked-licenses-no');
        await chooseRadio(page, 'driving-convictions-no');
        await chooseRadio(page, 'drug-alcohol-convictions-no');
        await chooseRadio(page, 'has-violations-no');
        await continueToStep(page, 'Accident History');
        await chooseRadio(page, 'has-accidents-no');
        await continueToStep(page, 'Employment History');

        // The identity the PSP report fixed: shown, explained, and not an input.
        await expect(page.getByText('Added by your carrier')).toBeVisible();
        await expect(page.getByText('Acme Trucking')).toBeVisible();
        await expect(page.locator('#emp-name-0')).toHaveCount(0);
        await expect(page.locator('#emp-dot-0')).toHaveCount(0);

        // Everything else on the same row is still the driver's to answer.
        await expect(page.locator('#emp-start-0-month')).toBeVisible();
        await expect(page.locator('#emp-reason-0')).toBeVisible();
    });

    test('a link that opens nothing leaves the driver an ordinary blank application', async ({ page }) => {
        await page.goto('/apply/e2e-company?invite=not-a-real-token');

        await expectStep(page, 'Personal Information');
        await expect(page.locator('#first-name')).toHaveValue('');
    });
});
