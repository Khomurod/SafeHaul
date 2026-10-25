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
 * ## Why this lane is blocking
 *
 * The font is served from `design-system/fonts/`, by the application and by
 * this catalog, so there is no machine-dependent input left and the lane is
 * enforced: a step that swallows its own failure can hide a lane that is never
 * green. The first test below is the tripwire: it asserts Inter actually
 * loaded, so a font problem is one legible failure instead of 150 pixel diffs.
 *
 * `scripts/test-ci-plan.mjs` (K1) asserts the workflow step carries no
 * `continue-on-error`, so this cannot quietly become advisory.
 *
 * Update baselines with:  npm run screenshots:pull -- <CI run id>
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
    // Switches with their words beside them (`showLabel`), every tone and disabled.
    ['components-switch--default', 'switch-with-label'],
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
    ['components-disclosure--card-variant', 'disclosure-card'],
    ['components-progressbar--tones', 'progress-bar-tones'],
    ['components-statusmedallion--tones', 'status-medallion-tones'],
    ['components-notice--tones', 'notice'],
    ['components-notice--with-title', 'notice-title'],
    ['components-notice--with-actions', 'notice-actions'],
    ['components-notice--heading-title', 'notice-heading-title'],
    ['components-sectionnavigation--with-icons', 'section-navigation'],
    ['components-sectionnavigation--wizard-steps', 'section-navigation-steps'],
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
    // The other half of the phone rule for `DataTable`: a table at 1440px, cards at 412px.
    ['components-datatable--cards-on-mobile', 'data-table-cards'],
    // Sorting by a header, and the "Sort by" list that replaces it above the cards.
    ['components-datatable--sortable', 'data-table-sortable'],
    ['components-datatable--sortable-cards', 'data-table-sortable-cards'],
    // A capped height, a dialog it fills, rows per page, and an empty list's action.
    ['components-datatable--bounded-height', 'data-table-bounded-height'],
    ['components-datatable--in-dialog', 'data-table-in-dialog'],
    ['components-datatable--page-size', 'data-table-page-size'],
    ['components-datatable--empty-with-action', 'data-table-empty-action'],

    // Dialogs.
    ['components-modal--default', 'modal'],
    ['components-modal--with-form', 'modal-with-form'],
    // The chrome contract. Five shots rather than one because the axes are
    // independent and a single composite would hide which moved.
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
    ['components-page-layout--header-with-count', 'page-header-count'],
    ['patterns-page-states--full-page-states', 'page-states'],
    ['patterns-page-states--empty-is-not-one-state', 'page-states-empty'],
    ['patterns-page-states--error-with-stale-data', 'page-states-stale-error'],
    ['patterns-page-states--on-an-inverse-surface', 'page-states-inverse'],
    ['patterns-compact-data-table--density-comparison', 'pattern-table-density'],
    ['patterns-native-table--default', 'pattern-native-table'],
    // The list-page standard: heading with count, toolbar, table; filters open; nothing found.
    ['patterns-list-page--default', 'pattern-list-page'],
    ['patterns-list-page--filters-open', 'pattern-list-page-filters'],
    ['patterns-list-page--no-matching-results', 'pattern-list-page-no-results'],
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
     * **When a test in a serial group fails, Playwright skips every remaining
     * test in the group**, at every worker count, including `--workers=1` and
     * `--max-failures=0`. With most of this lane's tests in this one group, a
     * change touching several components would report exactly one failure and
     * silently skip the rest — a re-record would look like "one baseline moved",
     * and a genuinely broken catalog would produce a diff artifact holding a
     * single image.
     *
     * Nothing here needs serial. `beforeAll` runs once per worker, so each
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
