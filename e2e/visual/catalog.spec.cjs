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
 * ## Why this lane is not blocking in CI
 *
 * The catalog deliberately does not load Inter — the application imports it from
 * rsms.me and the catalog omits that — so text rasterises with whatever the
 * runner's `sans-serif` resolves to. A baseline recorded on one machine can
 * therefore differ on another for reasons that have nothing to do with the
 * design system, and a lane that cries wolf gets ignored or deleted.
 *
 * So: this runs in CI, uploads its diff artifact, and is reported rather than
 * enforced, exactly as the repository already does for `typecheck` and the axe
 * lane. The `rendering font` test below is the tripwire — if it fails, the
 * baselines are being compared against a different font and every other
 * difference in the run is noise. Make this lane blocking once that test has
 * been green on the CI runner for a few weeks, and record the decision.
 *
 * Update baselines with:  npx playwright test --project=visual --update-snapshots
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

    // Primitives. Each subject is the story that shows the *most states*, not
    // the `--default` one: a first draft of this list used `badge--default`,
    // which renders one neutral badge, so changing the danger tint changed
    // nothing and the lane sat green through a real colour regression.
    ['components-button--variants', 'button-variants'],
    ['components-button--sizes', 'button-sizes'],
    ['components-button--with-icons', 'button-with-icons'],
    ['components-button--loading', 'button-loading'],
    ['components-iconbutton--variants', 'icon-button-variants'],
    ['components-iconbutton--sizes', 'icon-button-sizes'],
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
    ['components-badge--tones', 'badge-tones'],
    ['components-badge--with-icons', 'badge-with-icons'],
    ['components-card--padding', 'card-padding'],
    ['components-card--metric-card-tones', 'card-metric-tones'],
    ['components-card--with-header-and-actions', 'card-with-header'],
    ['components-tabs--default', 'tabs'],
    ['components-tabs--vertical', 'tabs-vertical'],
    ['components-tabs--with-badges', 'tabs-with-badges'],
    ['components-segmentedcontrol--toned-grid', 'segmented-toned-grid'],
    ['components-segmentedcontrol--with-disabled-option', 'segmented-disabled'],
    ['components-disclosure--default', 'disclosure'],
    ['components-progressbar--tones', 'progress-bar-tones'],
    ['components-statusmedallion--tones', 'status-medallion-tones'],
    ['components-sectionnavigation--with-icons', 'section-navigation'],
    ['components-form-structure--all-field-states', 'form-all-field-states'],
    ['components-form-structure--section', 'form-section'],

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
    test.describe.configure({ mode: 'serial', timeout: 120_000 });

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
     * and says so, instead of leaving 58 mystery diffs for someone to triage.
     *
     * It measures *metrics*, not `fontFamily`. The declared stack names Inter
     * whether or not Inter loaded — the catalog deliberately does not load it —
     * so asserting on the name would pass while the actual glyphs changed
     * underneath. 410.03px is what this pangram measures with the fallback the
     * baselines were captured against; a substituted font moves it by tens of
     * pixels, well outside this tolerance.
     */
    const BASELINE_PANGRAM_WIDTH = 410.03;

    test('rasterises with the font the baselines were captured with', async ({ page }) => {
        await page.goto(`${catalog.base}/iframe.html?id=${SUBJECTS[0][0]}&viewMode=story`, { waitUntil: 'networkidle' });
        await settle(page);
        const { family, width } = await fontFingerprint(page);
        expect(
            Math.abs(width - BASELINE_PANGRAM_WIDTH),
            `text metrics moved (${width}px vs ${BASELINE_PANGRAM_WIDTH}px, stack "${family}"). `
            + 'The baselines were captured against a different font, so every pixel difference '
            + 'in this run is noise. Re-record them on this runner, or install the font.',
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
