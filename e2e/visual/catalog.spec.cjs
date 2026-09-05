/**
 * Pixel baselines for the design system's own catalog.
 *
 * ## What this covers that the other guards do not
 *
 * `check:visual-contract` measures computed geometry and is the *blocking*
 * layer, because numbers are portable across machines and a diff of values says
 * what changed. `check:table-layout` measures overflow. Neither can see a colour
 * that is subtly wrong, a shadow that vanished, a border that moved to the wrong
 * edge, or an icon that now points the other way. That is what a screenshot is
 * for.
 *
 * ## Why this lane is blocking, as of 2026-08-25
 *
 * It was `continue-on-error` before, on the stated grounds that the catalog did
 * not load Inter so text rasterised with whatever the runner's `sans-serif`
 * resolved to. The CI record contradicted that diagnosis in both directions: all
 * 130 catalog baselines passed on GitHub's runners, and all 20 *application*
 * baselines failed — because the application fetched Inter from rsms.me and the
 * runner never got it. The lane had never been green, and nobody could see that,
 * because the step swallowed its own failure.
 *
 * The font is served from `design-system/fonts/` now, by the application and by
 * this catalog, so there is no machine-dependent input left and the lane is
 * enforced. The first test below is still the tripwire and matters more than
 * ever: it asserts Inter actually loaded, so a font problem is one legible
 * failure instead of 150 pixel diffs.
 *
 * `scripts/test-ci-plan.mjs` (K1) asserts the workflow step carries no
 * `continue-on-error`, so this cannot quietly become advisory again.
 *
 * Update baselines with:  npm run test:visual:update
 */
const { test, expect } = require('@playwright/test');
const { startCatalogServer } = require('./catalogServer.cjs');
const { freezeClock, settle, fontFingerprint, SHOT } = require('./settle.cjs');

/**
 * The subjects. Every approved primitive, the combinations the campaign was
 * about, the table, the dialogs, and the page patterns.
 */
const SUBJECTS = [
    // Foundations — the contract the whole campaign turned on.
    ['foundations-control-scale--input-and-button', 'control-scale-pairing'],
    ['foundations-control-scale--every-control', 'control-scale-every-control'],
    ['foundations-control-scale--icon-normalisation', 'control-scale-icons'],
    ['foundations-control-scale--labelled-field-with-action', 'control-scale-labelled-field'],
    ['foundations-icons--sizes', 'icon-sizes'],
    ['foundations-icons--inside-controls', 'icon-inside-controls'],

    // Primitives. Each subject is the story that shows the *most states*, not
    // the `--default` one: a first draft of this list used `badge--default`,
    // which renders one neutral badge, so changing the danger tint changed
    // nothing and the lane sat green through a real colour regression.
    ['components-button--variants', 'button-variants'],
    ['components-button--sizes', 'button-sizes'],
    ['components-button--with-icons', 'button-with-icons'],
    ['components-button--loading', 'button-loading'],
    ['components-button--success-tone', 'button-success-tone'],
    ['components-button--status-tones', 'button-status-tones'],
    ['components-button--ghost-tones', 'button-ghost-tones'],
    ['components-iconbutton--variants', 'icon-button-variants'],
    ['components-iconbutton--sizes', 'icon-button-sizes'],
    ['components-iconbutton--extra-small-and-round', 'icon-button-xs-round'],
    ['components-link--beside-a-button', 'link-beside-button'],
    ['components-link--sizes', 'link-sizes'],
    ['components-link--quiet-tone', 'link-quiet-tone'],
    ['components-input--states', 'input-states'],
    ['components-input--types', 'input-types'],
    ['components-select--states', 'select-states'],
    ['components-textarea--states', 'textarea-states'],
    ['components-textarea--sizes', 'textarea-sizes'],
    ['components-checkbox--states', 'choice-states'],
    ['components-checkbox--radio-group', 'choice-radio-group'],
    ['components-switch--states', 'switch-states'],
    ['components-fileinput--with-description', 'file-input'],
    ['components-fileinput--disabled', 'file-input-disabled'],
    ['components-avatar--sizes', 'avatar-sizes'],
    ['components-avatar--tones', 'avatar-tones'],
    ['components-avatar--person-or-organisation', 'avatar-shapes'],
    ['components-avatar--responsive-header', 'avatar-responsive'],
    ['components-badge--tones', 'badge-tones'],
    ['components-badge--with-icons', 'badge-with-icons'],
    ['components-card--padding', 'card-padding'],
    ['components-card--metric-card-tones', 'card-metric-tones'],
    ['components-card--with-header-and-actions', 'card-with-header'],
    ['components-tabs--default', 'tabs'],
    ['components-tabs--vertical', 'tabs-vertical'],
    ['components-tabs--with-badges', 'tabs-with-badges'],
    ['components-tabs--pill-variant', 'tabs-pill'],
    ['components-tabs--fitted', 'tabs-fitted'],
    ['components-chip--tones', 'chip-tones'],
    ['components-chip--sizes', 'chip-sizes'],
    ['components-chip--pressed-and-not', 'chip-pressed'],
    ['components-chip--as-link', 'chip-as-link'],
    ['components-chip--pressed-controls', 'chip-pressed-controls'],
    ['components-selectablecard--selectable', 'selectable-card-selected'],
    ['components-selectablecard--current-of-a-set', 'selectable-card-current'],
    ['components-selectablecard--plain-activation', 'selectable-card-activation'],
    ['components-selectablecard--toned-and-inverse', 'selectable-card-inverse'],
    ['components-segmentedcontrol--toned-grid', 'segmented-toned-grid'],
    ['components-segmentedcontrol--with-disabled-option', 'segmented-disabled'],
    ['components-disclosure--default', 'disclosure'],
    ['components-progressbar--tones', 'progress-bar-tones'],
    ['components-statusmedallion--tones', 'status-medallion-tones'],
    ['components-sectionnavigation--with-icons', 'section-navigation'],
    ['components-form-structure--all-field-states', 'form-all-field-states'],
    ['components-form-structure--section', 'form-section'],
    ['components-form-structure--inline-in-chips', 'form-inline-fields'],

    // Tables, at both densities and in every async state.
    ['components-datatable--default', 'data-table'],
    ['components-datatable--compact', 'data-table-compact'],
    ['components-datatable--with-selection', 'data-table-selection'],
    ['components-datatable--with-pagination', 'data-table-pagination'],
    ['components-datatable--loading', 'data-table-loading'],
    ['components-datatable--empty', 'data-table-empty'],
    ['components-datatable--error-state', 'data-table-error'],
    ['components-datatable--long-and-missing-content', 'data-table-extremes'],

    // Dialogs.
    ['components-modal--default', 'modal'],
    ['components-modal--with-form', 'modal-with-form'],
    // The chrome contract, added 2026-09-05. Five shots rather than one because
    // the axes are independent and a single composite would hide which moved.
    ['patterns-modal-chrome--sizes', 'modal-chrome-sizes'],
    ['patterns-modal-chrome--scroll-body', 'modal-chrome-scroll-body'],
    ['patterns-modal-chrome--danger-tone', 'modal-chrome-danger-tone'],
    ['patterns-modal-chrome--bottom-sheet', 'modal-chrome-bottom-sheet'],
    ['patterns-modal-chrome--fullscreen-mobile', 'modal-chrome-fullscreen'],
    ['components-confirmdialog--tones', 'confirm-dialog-tones'],
    ['components-confirmdialog--loading', 'confirm-dialog-loading'],
    ['components-confirmdialog--error-state', 'confirm-dialog-error'],

    // Page patterns and layout.
    ['components-page-layout--full-page-composition', 'page-layout'],
    ['patterns-page-states--full-page-states', 'page-states'],
    ['patterns-page-states--empty-is-not-one-state', 'page-states-empty'],
    ['patterns-page-states--error-with-stale-data', 'page-states-stale-error'],
    ['patterns-page-states--on-an-inverse-surface', 'page-states-inverse'],
    ['patterns-compact-data-table--density-comparison', 'pattern-table-density'],
    ['patterns-native-table--editable-matrix', 'pattern-native-table'],
    ['patterns-native-table--density-comparison', 'pattern-native-table-density'],
    /*
     * Added 2026-08-25 to close an asymmetry: `DataTable`'s empty state has had a
     * baseline since the lane was written, and the native-table contract — which
     * eleven feature files now read — had none for either state worth seeing.
     *
     * One honest limit on the frozen column. At 1440px the table fits, so nothing
     * scrolls under the sticky cell and the desktop shot shows only its surfaces,
     * divider and header corner. The 412px shot is the one that exercises the
     * contract, because there the overflow comes from the viewport rather than
     * from a scroll action — and a screenshot that depends on a scroll completing
     * is the timing-dependent input `.storybook/preview.css` warns about. So the
     * overlap is proven at one width deterministically instead of at two widths
     * flakily, and `check:visual-contract` measures the cell's background,
     * `position` and `left` at both.
     */
    ['patterns-native-table--empty-row', 'pattern-native-table-empty'],
    ['patterns-native-table--sticky-first-column', 'pattern-native-table-sticky'],
    ['patterns-filter-panel--default', 'pattern-filter-panel'],
    ['patterns-filter-panel--no-matching-results', 'pattern-filter-no-results'],
    ['patterns-title-deletion-list--default', 'pattern-deletion-list'],
    ['patterns-modal-form--field-validation-error', 'pattern-modal-form-error'],
    ['patterns-back-navigation-and-page-header--with-status', 'pattern-page-header'],
    ['patterns-section-navigation-and-content--default', 'pattern-section-nav'],
    ['patterns-provider-integration-row--all-states', 'pattern-integration-rows'],
];

const WIDTHS = [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'mobile', width: 412, height: 915 },
];

test.describe('@visual design-system catalog', () => {
    /*
     * NOT `mode: 'serial'`, and that is the point.
     *
     * It was serial until 2026-08-25, and serial mode has one consequence that
     * matters more than anything it was buying: **when a test in a serial group
     * fails, Playwright skips every remaining test in the group.** With 142 of
     * this lane's 174 tests in this one group, a change touching several
     * components reported exactly one failure and silently skipped the rest — so
     * a re-record looked like "one baseline moved", and a genuinely broken
     * catalog produced a diff artifact holding a single image. Measured: a
     * one-line CSS change moved several subjects, and the run reported
     * `1 failed / 81 did not run` at every worker count, including `--workers=1`
     * and `--max-failures=0`.
     *
     * That is also why the twenty `app.spec.cjs` font failures were all visible
     * in CI while this file's were not: that describe was never serial.
     *
     * Nothing here needed serial. `beforeAll` runs once per worker, so each
     * worker gets its own catalog server on its own random port (`listen(0)`),
     * and the subjects are independent screenshots with no shared state and no
     * ordering between them.
     */
    test.describe.configure({ timeout: 120_000 });

    let catalog;
    let available;

    test.beforeAll(async () => {
        catalog = await startCatalogServer();
        const index = await (await fetch(`${catalog.base}/index.json`)).json();
        available = new Set(
            Object.values(index.entries || {})
                .filter((entry) => entry.type !== 'docs')
                .map((entry) => entry.id),
        );
    });

    test.afterAll(async () => {
        catalog?.server?.close();
    });

    /**
     * The tripwire, and the first test in the file on purpose.
     *
     * If the runner rasterises with different glyphs, every baseline below
     * differs for a reason that is not a design-system change. This fails first
     * and says so, instead of leaving 65 mystery diffs for someone to triage.
     *
     * Two assertions, because they fail differently. `interLoaded` is
     * `document.fonts.check()` — the direct question, which names the cause in
     * one sentence when the vendored font does not reach the page. The metrics
     * reading catches what `check()` cannot: a *different build* of Inter, whose
     * glyphs differ while the family name matches. Neither is
     * `getComputedStyle().fontFamily`, which names Inter whether or not Inter
     * loaded and is exactly how a substitution hid for a whole campaign.
     */
    const BASELINE_PANGRAM_WIDTH = 426;

    test('rasterises with the font the baselines were captured with', async ({ page }) => {
        await page.goto(`${catalog.base}/iframe.html?id=${SUBJECTS[0][0]}&viewMode=story`, { waitUntil: 'networkidle' });
        await settle(page);
        const { family, width, interLoaded } = await fontFingerprint(page);
        expect(
            interLoaded,
            `Inter did not load (stack "${family}"). It is served from `
            + '`src/design-system/fonts/` through `design-system/index.css`, so this is a '
            + 'build or asset-pipeline failure, not a network one. Every pixel difference in '
            + 'this run is noise until it is fixed.',
        ).toBe(true);
        expect(
            Math.abs(width - BASELINE_PANGRAM_WIDTH),
            `text metrics moved (${width}px vs ${BASELINE_PANGRAM_WIDTH}px, stack "${family}"). `
            + 'Inter loaded, but not the build the baselines were captured with. Check '
            + '`src/design-system/fonts/` against the diff before re-recording.',
        ).toBeLessThan(2);
    });

    /**
     * Guards against the subject list silently resolving to nothing — a renamed
     * story would otherwise just stop being covered.
     */
    test('every named subject exists in the built catalog', () => {
        const missing = SUBJECTS.map(([id]) => id).filter((id) => !available.has(id));
        expect(missing, 'a renamed story stops being covered without failing anything').toEqual([]);
    });

    for (const { label, width, height } of WIDTHS) {
        for (const [id, name] of SUBJECTS) {
            test(`${name} @ ${label}`, async ({ page }) => {
                test.skip(!available.has(id), `story ${id} is not in the catalog`);
                await page.setViewportSize({ width, height });
                await freezeClock(page);
                await page.goto(`${catalog.base}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'networkidle' });
                await settle(page);
                await expect(page).toHaveScreenshot(`${name}-${label}.png`, { ...SHOT, fullPage: true });
            });
        }
    }
});
