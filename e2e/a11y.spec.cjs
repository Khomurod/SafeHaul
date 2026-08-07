// E3: automated accessibility gate on the mobile-primary critical journeys
// (signing, guest intake, auth). Asserts no serious/critical axe violations —
// the real-browser complement to the vitest-axe component gate (which can't
// compute layout-dependent rules like colour-contrast).
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const {
    fillStep1,
    fillStep2,
    fillStep3RequiredFields,
    uploadStandardDocuments,
    continueToStep,
  continueAnywayPastEmploymentCoverage,
    chooseRadio,
    completeRemainingSteps,
    applySignature,
    submitApplication,
} = require('./helpers/wizardHelpers.cjs');

/** Return the ids (with impact) of serious/critical axe violations on the page. */
async function seriousViolations(page) {
    const { violations } = await new AxeBuilder({ page })
        // Scan the rendered document; tag-filtering kept default (WCAG 2.x A/AA).
        .analyze();
    return violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
}

// Tagged @a11y so CI can run it as a dedicated, initially NON-BLOCKING lane
// (continue-on-error) and exclude it from the deploy-gating e2e run until it is
// confirmed green in CI — this spec can't be run in the sandbox (browser download
// blocked), so it must not block deploys on unverified, possibly pre-existing
// violations. Flip to blocking once green.
test.describe('@a11y mobile-critical journeys (no serious/critical violations)', () => {
    // The public-application journey walks nine steps and runs a dozen axe scans,
    // so the default 30 s per-test budget is not enough.
    test.describe.configure({ timeout: 180_000 });

    test('guest intake landing', async ({ page }) => {
        await page.goto('/apply/e2e-company');
        await page.waitForLoadState('networkidle');
        expect(await seriousViolations(page)).toEqual([]);
    });

    test('guest intake chooser', async ({ page }) => {
        await page.goto('/apply/e2e-company?e2eIntake=choice');
        await expect(page.getByText('Fill Out Manually')).toBeVisible({ timeout: 15_000 });
        expect(await seriousViolations(page)).toEqual([]);
    });

    // Every wizard step, not only the landing step. The custom-questions,
    // review and consent steps carry the densest controls in the product and
    // were the ones with unlabelled inputs before the design-system migration.
    test('public driver application — every step', async ({ page }) => {
        await page.goto('/apply/e2e-company');
        await fillStep1(page, 'a11y');
        expect(await seriousViolations(page)).toEqual([]);   // qualifications

        await fillStep2(page);
        await fillStep3RequiredFields(page);
        expect(await seriousViolations(page)).toEqual([]);   // license, uploads empty

        await uploadStandardDocuments(page);
        expect(await seriousViolations(page)).toEqual([]);   // license, uploads landed

        await continueToStep(page, 'Motor Vehicle Record');
        expect(await seriousViolations(page)).toEqual([]);

        // Open every conditional explanation so the "yes" branches are scanned too.
        await chooseRadio(page, 'consent-mvr-yes');
        await chooseRadio(page, 'revoked-licenses-yes');
        await chooseRadio(page, 'driving-convictions-yes');
        await chooseRadio(page, 'drug-alcohol-convictions-yes');
        expect(await seriousViolations(page)).toEqual([]);

        await chooseRadio(page, 'revoked-licenses-no');
        await chooseRadio(page, 'driving-convictions-no');
        await chooseRadio(page, 'drug-alcohol-convictions-no');
        await continueToStep(page, 'Accident History');

        // A dynamic row exercises the per-row ids, selects and radio groups.
        await page.getByRole('button', { name: '+ Add Accident' }).click();
        await expect(page.locator('#accident-city-0')).toBeVisible();
        expect(await seriousViolations(page)).toEqual([]);
        await page.getByRole('button', { name: 'Remove Accident #1' }).click();

        await continueToStep(page, 'Employment History');
        await page.getByRole('button', { name: '+ Add Employer' }).click();
        await expect(page.locator('#emp-street-0')).toBeVisible();
        expect(await seriousViolations(page)).toEqual([]);
        await page.getByRole('button', { name: 'Remove Employer #1' }).click();

        await continueAnywayPastEmploymentCoverage(page);
        await chooseRadio(page, 'has-felony-yes');
        expect(await seriousViolations(page)).toEqual([]);

        await chooseRadio(page, 'has-felony-no');
        await continueToStep(page, 'Review Information');
        expect(await seriousViolations(page)).toEqual([]);

        await page.getByRole('button', { name: 'Confirm & Proceed' }).click();
        await expect(page.locator('#step-title')).toContainText('Agreements & Signature');
        expect(await seriousViolations(page)).toEqual([]);

        await applySignature(page);
        await submitApplication(page);
        await expect(page.getByText('Application Submitted!')).toBeVisible();
        // Success screen with the blocking required-documents checklist.
        expect(await seriousViolations(page)).toEqual([]);
    });

    test('public driver application — queued (offline) screen', async ({ page, context }) => {
        await page.goto('/apply/e2e-company?e2eForceQueue=1');
        await fillStep1(page, 'a11yq');
        await fillStep2(page);
        await fillStep3RequiredFields(page);
        await uploadStandardDocuments(page);
        await continueToStep(page, 'Motor Vehicle Record');
        await completeRemainingSteps(page);
        await applySignature(page);
        await context.setOffline(true);
        await submitApplication(page);
        await expect(page.getByRole('heading', { name: 'Application Saved', exact: true })).toBeVisible({ timeout: 15_000 });
        expect(await seriousViolations(page)).toEqual([]);
    });

    test('public signing room', async ({ page }) => {
        await page.goto('/sign/e2e-company/e2e-request?token=e2e-token&e2eSign=mock');
        await page.getByRole('button', { name: /I Agree - Proceed to Sign/i }).click();
        await expect(page.locator('[data-signing-page="1"]')).toBeVisible({ timeout: 10_000 });
        expect(await seriousViolations(page)).toEqual([]);
    });

    // The signature pad is the one signing surface a scan of the room never
    // reaches, because it only exists while the dialog is open — and it is the
    // step that actually binds the signer. Scanned with the dialog raised so its
    // contrast and naming are covered too.
    test('signature capture dialog', async ({ page }) => {
        await page.goto('/sign/e2e-company/e2e-request?token=e2e-token&e2eSign=mock');
        await page.getByRole('button', { name: /I Agree - Proceed to Sign/i }).click();
        await expect(page.locator('[data-signing-page="1"]')).toBeVisible({ timeout: 10_000 });

        await page.getByRole('button', { name: /Tap to sign|tap to redraw/i }).first().click();
        await expect(page.getByRole('dialog', { name: /Draw your signature/i })).toBeVisible();

        expect(await seriousViolations(page)).toEqual([]);
    });
});
