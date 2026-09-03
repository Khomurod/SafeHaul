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

/**
 * The carrier's own side: the Manual/AI choice, and where each one lands. This
 * needs no callable — the choice and the editor render on their own; the reading,
 * saving and link-minting are covered by their unit suites, which mock the
 * callables an E2E run cannot reach.
 */
test.describe('a carrier starting an application', () => {
    test.describe.configure({ timeout: 90_000 });

    const START_URL = '/company/drivers/start-application?e2eAuth=company_admin';

    test('asks how to fill it in, then manual goes to the editable form', async ({ page }) => {
        await page.goto(START_URL);
        await page.getByRole('button', { name: /Start an application/i }).click();

        // The fork comes first.
        await expect(page.getByRole('heading', { name: 'Let AI read the documents' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Fill in manually' })).toBeVisible();

        await page.getByTestId('mode-manual').click();

        // The editable form — no reader in the manual path — with the identity
        // fields the recruiter types (email and phone key the draft).
        await expect(page.getByRole('heading', { name: 'Driver details' })).toBeVisible();
        await expect(page.getByText('Read the documents')).toHaveCount(0);
    });

    test('the AI choice leads to the document upload step', async ({ page }) => {
        await page.goto(START_URL);
        await page.getByRole('button', { name: /Start an application/i }).click();
        await page.getByTestId('mode-ai').click();

        await expect(page.getByRole('heading', { name: "Upload the driver's documents" })).toBeVisible();
        // The reader is here, in its pre-run state, before any document is attached.
        await expect(page.getByRole('heading', { name: 'Read the documents' })).toBeVisible();
    });
});
