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
 * purpose, so a flow that lives behind a callable is otherwise unreachable. That
 * fixture THROWS for an unknown token, exactly as the callable does, so the
 * failure path below is a real test of the client's handling rather than of the
 * double.
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

    test('a link that opens nothing says so, and lets the driver continue', async ({ page }) => {
        await page.goto('/apply/e2e-company?invite=not-a-real-token');

        /*
         * This used to fall through in silence, and that behaviour was pinned here
         * as correct on the grounds that a driver following a stale link should
         * land on the ordinary application rather than a diagnostic. Two things
         * were wrong with it. The driver could not tell a dead link from a working
         * one — and worse, the fall-through never claims the invitation, so the
         * carrier's locked employers go unenforced and it receives a second,
         * unprepared application, losing the 49 CFR 391.21 employment history it
         * had prepared. Changed 2026-09-08.
         */
        await expect(
            page.getByRole('heading', { level: 1, name: 'This link could not be opened' }),
        ).toBeVisible();
        // Wrong and expired are deliberately one message, so nothing here says
        // which of the two it was; and neither is worth retrying.
        await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);

        // Starting fresh is now an explicit choice rather than something that
        // happens to them.
        await page.getByRole('button', { name: 'Continue to the application' }).click();

        await expectStep(page, 'Personal Information');
        await expect(page.locator('#first-name')).toHaveValue('');
    });
});

/**
 * The replacement link, in a real browser.
 *
 * ## The reported failure, and why only a browser could show it
 *
 * A carrier-prepared application for a driver who had reached the consent step.
 * The recruiter pressed "Create a replacement link"; the driver opened it and the
 * page rendered the fresh-application chooser — "How would you like to start your
 * driver application?" — with their own half-finished application sitting behind
 * the link. Measured in production on 2026-09-09.
 *
 * `exchangeApplicationInvite` answered correctly the whole time: `requiresIdentity`,
 * with no answers and no token. The defect was that the outcome matched no branch
 * in `resolveApplyStatusScreen`, and the chooser sits at the bottom of it. Nothing
 * short of rendering the page could see that, which is why it is here rather than
 * only in the contract suite.
 *
 * Served by the `e2e-invite-token-taken-over` fixture in
 * `applicationDraftService.js`: a second token rather than a mode on the first,
 * because the two are different facts about one draft and this needs the one that
 * comes after the driver has saved. The fixture checks the claim the way the
 * server does and THROWS `permission-denied` when it does not match, so the
 * refusal below tests the client rather than the double.
 */
test.describe('a replacement link for a driver who already started', () => {
    const TAKEN_OVER_URL = '/apply/e2e-company?invite=e2e-invite-token-taken-over&k=e2e-applicant-key';

    /** Everything the confirmation screen asks for. */
    async function confirmIdentity(page, overrides = {}) {
        const claim = {
            lastName: 'Driver',
            dob: '1990-01-01',
            ssn: '123-45-6789',
            contact: 'prepared@example.com',
            ...overrides,
        };
        await page.getByLabel(/^Last name/).fill(claim.lastName);
        await page.getByLabel(/^Date of birth/).fill(claim.dob);
        await page.getByLabel(/^Social Security Number/).fill(claim.ssn);
        await page.getByLabel(/^Email or phone number/).fill(claim.contact);
        await page.getByRole('button', { name: 'Continue my application' }).click();
    }

    test('asks who they are instead of offering a fresh application', async ({ page }) => {
        await page.goto(TAKEN_OVER_URL);

        await expect(
            page.getByRole('heading', { level: 1, name: /Confirm it’s you/ }),
        ).toBeVisible();
        // The reported symptom, asserted as an absence.
        await expect(page.getByRole('button', { name: 'Fill Out Manually' })).toHaveCount(0);
        await expect(page.getByText(/How would you like to start/)).toHaveCount(0);
    });

    test('returns them to their own answers, at the step they left', async ({ page }) => {
        await page.goto(TAKEN_OVER_URL);
        await page.getByRole('heading', { level: 1, name: /Confirm it’s you/ }).waitFor();

        await confirmIdentity(page);

        // `lastStep: 3` on the fixture — the driving record, not page one. A
        // confirmed driver handed their answers and dropped at the start of the
        // wizard reads as "nothing was saved", which is the failure the whole
        // draft feature exists to prevent.
        await expectStep(page, 'Motor Vehicle Record');
        // The confirmation screen is gone, and so is any offer to start again.
        await expect(page.getByRole('heading', { level: 1, name: /Confirm it’s you/ })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Fill Out Manually' })).toHaveCount(0);
        // *Which* answers came back is pinned by the contract suite, which can read
        // the payload; from here the observable fact is the step.
    });

    test('says so when the details do not match, and keeps asking', async ({ page }) => {
        await page.goto(TAKEN_OVER_URL);
        await page.getByRole('heading', { level: 1, name: /Confirm it’s you/ }).waitFor();

        await confirmIdentity(page, { dob: '1985-05-05' });

        await expect(page.getByText(/do not match this application/)).toBeVisible();
        // Somebody who mistyped a date needs another go, not a new application.
        await expect(page.getByRole('heading', { level: 1, name: /Confirm it’s you/ })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Fill Out Manually' })).toHaveCount(0);
    });

    test('names the field a driver left blank rather than spending an attempt', async ({ page }) => {
        await page.goto(TAKEN_OVER_URL);
        await page.getByRole('heading', { level: 1, name: /Confirm it’s you/ }).waitFor();

        await page.getByLabel(/^Last name/).fill('Driver');
        await page.getByRole('button', { name: 'Continue my application' }).click();

        await expect(page.getByText('Enter your date of birth.')).toBeVisible();
    });

    test('lets them start a new application instead, as a press', async ({ page }) => {
        await page.goto(TAKEN_OVER_URL);
        await page.getByRole('heading', { level: 1, name: /Confirm it’s you/ }).waitFor();

        await page.getByRole('button', { name: 'Start a new application instead' }).click();

        /*
         * A fresh application, page one, empty. Exactly what the dead-link case
         * above asserts, and for the same reason: the way out is a press.
         *
         * Not the intake chooser, because an E2E run sets `intakeMode` to manual
         * on load unless `?e2eIntake=choice` says otherwise — so what a browser
         * test can see here is the wizard behind it. The chooser's own position in
         * the render order is pinned by `PublicApplyScreens.gate.test.jsx` and by
         * the contract suite, which control that flag.
         */
        await expectStep(page, 'Personal Information');
        await expect(page.locator('#first-name')).toHaveValue('');
        await expect(page.getByRole('heading', { level: 1, name: /Confirm it’s you/ })).toHaveCount(0);
    });
});

/**
 * The carrier's own side: the Manual/AI choice, and where each one lands. This
 * needs no callable — the choice and the editor render on their own; the reading,
 * saving and link-minting are covered by their unit suites, which mock the
 * callables an E2E run cannot reach.
 *
 * Reached from the unified unfinished-applications workspace since 2026-09-10,
 * where starting an application is the primary action. `e2eUnfinished=mock` puts
 * the worklist behind it in a known state, so what these cases prove is the
 * wizard and not how a credential-less list call happens to fail.
 */
test.describe('a carrier starting an application', () => {
    test.describe.configure({ timeout: 90_000 });

    const START_URL = '/company/drivers/unfinished?e2eAuth=company_admin&e2eUnfinished=mock';
    const LEGACY_URL = '/company/drivers/start-application?e2eAuth=company_admin&e2eUnfinished=mock';

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

    test('shows both origins in one list, and opens only the carrier’s own', async ({ page }) => {
        await page.goto(START_URL);

        // A driver-started row and a carrier-prepared row, in one table.
        await expect(page.getByText('Dana Whitfield')).toBeVisible();
        await expect(page.getByText('Marcus Iyer')).toBeVisible();
        await expect(page.getByRole('button', { name: /Open the application for Marcus Iyer/i })).toBeVisible();
        // The driver's own answers are not the carrier's to read, merged screen or
        // not — and `getCompanyPreparedDraft` would refuse the row anyway.
        await expect(page.getByRole('button', { name: /Open the application for Dana Whitfield/i })).toHaveCount(0);
    });

    test('the old start-application URL still lands somewhere useful', async ({ page }) => {
        // A recruiter may have bookmarked it. A 404 would be a worse outcome than a
        // redirect to where the feature went.
        await page.goto(LEGACY_URL);

        await expect(page.getByRole('heading', { level: 1, name: 'Unfinished applications' })).toBeVisible();
        await expect(page).toHaveURL(/\/company\/drivers\/unfinished/);
        // The auth parameter survived, or this page would be signed out.
        await expect(page).toHaveURL(/e2eAuth=company_admin/);
    });
});
