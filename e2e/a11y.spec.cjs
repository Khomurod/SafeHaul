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

// Tagged @a11y for grouping only. These specs run inside the BLOCKING
// `frontend-e2e` lane as of 2026-08-25.
//
// They used to be excluded from it with `--grep-invert "@a11y"` and run in a
// separate `continue-on-error` job, because when they were written the browser
// could not be downloaded in the sandbox and they had never been proven. They
// have been green in CI ever since — 11/11 on every run of the campaign that
// wrote the "flip to blocking once green" note. An accessibility gate nobody has
// to pass is a report, not a gate. `scripts/test-ci-plan.mjs` (K2) asserts no
// workflow step excludes them again.
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
        await chooseRadio(page, 'has-violations-no');
        await continueToStep(page, 'Accident History');

        // A dynamic row exercises the per-row ids, selects and radio groups. The
        // list only appears once the applicant says they had an accident.
        await chooseRadio(page, 'has-accidents-yes');
        await page.getByRole('button', { name: '+ Add Accident' }).click();
        await expect(page.locator('#accident-city-0')).toBeVisible();
        expect(await seriousViolations(page)).toEqual([]);
        await page.getByRole('button', { name: 'Remove Accident #1' }).click();
        await chooseRadio(page, 'has-accidents-no');

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

/**
 * The surfaces that changed hands on 2026-08-25, and the keyboard behaviour axe
 * cannot see.
 *
 * axe is a static check on a rendered tree: it can tell you a tab has no
 * accessible name, and it cannot tell you the arrow keys do nothing. Eleven tab
 * strips, four toggle groups and nine file pickers moved onto design-system
 * primitives in that campaign; these assert the parts of that move a screenshot
 * and an axe scan both miss.
 */
test.describe('@a11y migrated design-system surfaces', () => {
    test.describe.configure({ timeout: 120_000 });

    test('company workspace tab strips: axe, roving tabIndex, and the arrow keys', async ({ page }) => {
        await page.goto('/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock');
        const strip = page.getByRole('tablist', { name: 'Documents workspace views' });
        await expect(strip).toBeVisible({ timeout: 30_000 });

        expect(await seriousViolations(page)).toEqual([]);

        // Roving tabIndex: one stop for the whole strip, not one per tab.
        const tabs = strip.getByRole('tab');
        const count = await tabs.count();
        expect(count).toBeGreaterThan(1);
        let tabbable = 0;
        for (let i = 0; i < count; i += 1) {
            if (await tabs.nth(i).getAttribute('tabindex') === '0') tabbable += 1;
        }
        expect(tabbable).toBe(1);

        // Selection is `aria-selected`, and the name is only the label — no
        // "(selected)" suffix, which is what every exact-name query depends on.
        const selected = strip.getByRole('tab', { selected: true });
        await expect(selected).toHaveAccessibleName('Overview');

        // The arrow keys move AND select, and focus follows.
        await selected.focus();
        await page.keyboard.press('ArrowRight');
        await expect(strip.getByRole('tab', { selected: true })).toHaveAccessibleName('Sent Documents');
        await expect(page.locator(':focus')).toHaveAccessibleName('Sent Documents');
        await page.keyboard.press('End');
        await expect(strip.getByRole('tab', { selected: true })).toHaveAccessibleName('Application Forms');
        await page.keyboard.press('Home');
        await expect(strip.getByRole('tab', { selected: true })).toHaveAccessibleName('Overview');
    });

    test('the profile photo picker is reachable and named by its field', async ({ page }) => {
        await page.goto('/company/profile?e2eAuth=company_admin');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

        expect(await seriousViolations(page)).toEqual([]);

        /*
         * The structural rule the `FileInput` contract exists for, on a screen
         * that always has one. Two of the nine pickers it replaced were a hidden
         * input with no keyboard path to the picker at all; two more, including
         * this one, named the TRIGGER rather than the field.
         */
        const picker = page.locator('input[type="file"]').first();
        await expect(picker).toHaveCount(1);
        await expect(picker).not.toHaveAttribute('hidden', /.*/);
        expect(await picker.getAttribute('tabindex')).not.toBe('-1');
        await expect(picker).toHaveAccessibleName('Profile photo');
        await picker.focus();
        await expect(picker).toBeFocused();

        /*
         * The upload's live region, in a real browser, on a real screen.
         *
         * This picker owned a `role="status"` region before the migration and
         * lost it — `aria-busy` on an input the upload disables and unfocuses
         * announces nothing, and neither does a button label changing to
         * "Uploading…". `FileInput` renders the region for every picker now, and
         * two things about it can only be checked here: that it is present and
         * EMPTY while idle (a live region has to exist before it fills for the
         * fill to be announced), and that `ds-visually-hidden` really clips it,
         * so the message is announced without ever being drawn. jsdom computes
         * no layout and cannot see the second one.
         */
        const status = page.locator('.ds-file-input [role="status"]');
        await expect(status).toHaveCount(1);
        await expect(status).toHaveText('');
        const clipped = await status.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
                width: Math.round(box.width),
                height: Math.round(box.height),
                display: style.display,
                visibility: style.visibility,
                live: el.getAttribute('aria-live'),
            };
        });
        // Clipped to 1x1, never `display: none` or `visibility: hidden`, both of
        // which would take it out of the accessibility tree with the
        // announcement. Asserted as the intent rather than as one exact
        // `display` value, which is a detail of how the utility clips.
        expect(clipped.width).toBe(1);
        expect(clipped.height).toBe(1);
        expect(clipped.display).not.toBe('none');
        expect(clipped.visibility).toBe('visible');
        expect(clipped.live).toBe('polite');
    });

    test('the change-review decision group announces its selection', async ({ page }) => {
        await page.goto('/review-change/e2e-token-1?e2eReview=mock');
        const group = page.getByRole('group').first();
        await expect(group).toBeVisible({ timeout: 30_000 });

        expect(await seriousViolations(page)).toEqual([]);

        // `SegmentedControl` is deliberately `role="group"` + `aria-pressed`
        // rather than a radiogroup, so the state must be on the option.
        const options = group.getByRole('button');
        await expect(options.first()).toHaveAttribute('aria-pressed', /true|false/);
        await options.first().click();
        await expect(options.first()).toHaveAttribute('aria-pressed', 'true');
    });

    test('every focusable control on the candidate list shows a focus ring', async ({ page }) => {
        await page.goto('/company/drivers/applications?e2eAuth=company_admin');
        await expect(page.getByRole('table').first()).toBeVisible({ timeout: 30_000 });

        expect(await seriousViolations(page)).toEqual([]);

        /*
         * The 2026-08-25 walkthrough found seven call sites rendering the
         * browser's black UA outline instead of the product's blue ring, because
         * `focus-visible:shadow-ds-focus` draws a box-shadow and does not replace
         * `outline`. `utilities.css` fixes that globally; this proves it on a real
         * screen, by tabbing and asserting SOMETHING visible marks focus.
         */
        const unmarked = [];
        for (let i = 0; i < 20; i += 1) {
            await page.keyboard.press('Tab');
            const bad = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el || el === document.body) return null;
                const s = getComputedStyle(el);
                const hasRing = s.boxShadow !== 'none' || s.outlineStyle !== 'none';
                // The UA default is `auto 1px rgb(16, 16, 16)` — near-black in a
                // product whose focus colour is blue, and the exact signature of
                // a call site that forgot the ring.
                const uaBlack = /rgb\(16, 16, 16\)/.test(s.outlineColor) && s.boxShadow === 'none';
                if (hasRing && !uaBlack) return null;
                const name = (el.getAttribute('aria-label') || el.textContent || '')
                    .replace(/\s+/g, ' ').trim().slice(0, 40);
                return `${el.tagName} "${name}" outline=${s.outlineStyle} ${s.outlineColor} shadow=${s.boxShadow}`;
            });
            if (bad) unmarked.push(bad);
        }
        /*
         * Naming them matters. This assertion found twelve of them at once — the
         * whole company sidebar navigation, rendering the UA black outline — and
         * a bare `toBe(true)` would have said only that something, somewhere,
         * on some Tab press, was wrong.
         */
        expect(unmarked, 'every focused control must show the product focus ring').toEqual([]);
    });
});
