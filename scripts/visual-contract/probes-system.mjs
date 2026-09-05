/**
 * What gets measured ABOVE and BELOW the components.
 *
 * Split out of `probes.mjs` on 2026-09-05, when the two step-rail probes took
 * that file past the 500-line maximum. The boundary is by responsibility and
 * not by line count: `probes.mjs` asks whether ONE PRIMITIVE'S OWN CHROME still
 * holds — its widths, its heights, the properties a caller may no longer choose.
 * These ask about the two things a primitive sits between.
 *
 * - **Foundations** are the shared scales themselves — the control heights, the
 *   icon steps, the type ramp. A component probe catches a component that
 *   drifted off a scale; only these catch the scale drifting under all of them.
 * - **Patterns** are compositions of several primitives, where the contract is
 *   the RELATIONSHIP — a rail beside its content region, a dialog with its
 *   footer. No single component's probe can see a gap between two of them.
 *
 * Same entry shape, same checker, one merged table to every consumer.
 */

export const SYSTEM_PROBES = [
    {
        story: 'patterns-modal-chrome--sizes',
        label: 'the dialog chrome, and the eight widths that replaced thirty class lists',
        /*
         * Specimens rather than eight dialogs, because eight `position: fixed`
         * overlays would each cover the last and nothing could be measured. What
         * is under test is the CSS contract, and this reads it directly: the
         * widths, plus the surface, hairline border, radius and shadow that a
         * caller may no longer choose. A `className` slipping back onto a call
         * site is invisible to every static rule; a width that stops resolving
         * is not invisible here.
         */
        selectors: Object.fromEntries(
            ['sm', 'md', 'lg', 'xl', '2xl', '4xl', '5xl', '7xl'].map(
                (size) => [`panel[${size}]`, `.ds-modal__panel[data-size='${size}']`],
            ),
        ),
        properties: [
            'maxWidth', 'maxHeight', 'borderRadius', 'borderTopWidth', 'borderTopColor',
            'backgroundColor', 'boxShadow',
        ],
    },
    {
        story: 'foundations-control-scale--input-and-button',
        label: 'the control scale, and the pairing it exists for',
        selectors: {
            'input[md]': '.ds-form-control:not([data-size])',
            'input[sm]': ".ds-form-control[data-size='sm']",
            'input[lg]': ".ds-form-control[data-size='lg']",
            'button[md]': ".ds-button[data-size='md']:not(.ds-icon-button)",
            'button[sm]': ".ds-button[data-size='sm']:not(.ds-icon-button)",
            'button[lg]': ".ds-button[data-size='lg']:not(.ds-icon-button)",
            'iconButton[md]': ".ds-icon-button[data-size='md']",
        },
        properties: ['height', 'fontSize', 'borderRadius', 'paddingLeft', 'paddingRight'],
    },
    {
        story: 'foundations-control-scale--every-control',
        label: 'an input and a select are the same control, and must look it',
        selectors: {
            // `backgroundColor` is the point. `.ds-form-control:read-only` used to
            // match every `<select>` — the pseudo-class means "not `:read-write`",
            // and only inputs and textareas ever are — so every dropdown in the
            // product wore the greyed read-only treatment. Height and type matched,
            // which is exactly why nobody caught it.
            'input[md]': 'input.ds-form-control:not([data-size])',
            'select[md]': 'select.ds-form-control:not([data-size])',
        },
        properties: ['height', 'fontSize', 'backgroundColor', 'borderColor', 'color'],
    },
    {
        /*
         * The icon scale itself: six steps, measured, in one frame.
         *
         * `Icon.css` states these through `:where()`, which has ZERO specificity
         * — deliberately, so the container rules below still win. That makes the
         * scale unusually easy to lose: any stylesheet that mentions `.ds-icon`
         * at all outranks it, and the failure is a glyph quietly rendering at
         * the wrong size rather than an error. This reads the numbers back.
         */
        story: 'foundations-icons--scale',
        label: 'every step of the icon scale',
        selectors: {
            'icon[xs]': ".ds-icon[data-size='xs']",
            'icon[sm]': ".ds-icon[data-size='sm']",
            'icon[md]': ".ds-icon[data-size='md']",
            'icon[lg]': ".ds-icon[data-size='lg']",
            'icon[xl]': ".ds-icon[data-size='xl']",
            'icon[2xl]': ".ds-icon[data-size='2xl']",
            'icon[3xl]': ".ds-icon[data-size='3xl']",
        },
        properties: ['width', 'height'],
    },
    {
        /*
         * And the rule that outranks it. Every glyph in this story is written
         * `size="md"`; each renders at the size its CONTAINER decided. If the
         * `:where()` above were ever written as a plain class selector these
         * three would all read 16px and two buttons in a row would carry
         * different-sized glyphs — which is the defect the control scale was
         * built to end, arriving through the icon contract instead.
         */
        story: 'foundations-icons--inside-controls',
        label: 'a container still outranks the icon scale',
        selectors: {
            'icon in button[sm]': ".ds-button[data-size='sm'] .ds-button__content > svg",
            'icon in button[md]': ".ds-button[data-size='md'] .ds-button__content > svg",
            'icon in button[lg]': ".ds-button[data-size='lg'] .ds-button__content > svg",
        },
        properties: ['width', 'height'],
    },
    {
        story: 'foundations-control-scale--icon-normalisation',
        label: 'icon size is the system\'s decision, not the call site\'s',
        selectors: {
            'icon in button[md]': ".ds-button[data-size='md'] .ds-button__content > svg",
            'icon in button[sm]': ".ds-button[data-size='sm'] .ds-button__content > svg",
            'icon in button[lg]': ".ds-button[data-size='lg'] .ds-button__content > svg",
        },
        properties: ['width', 'height'],
    },
    {
        /*
         * The gap between a glyph and its label — the other half of the rule.
         *
         * The design system owns this as well as the icon size: `.ds-button` sets
         * `gap: var(--ds-space-2)` and `.ds-button__content` inherits it. Only
         * the icon size was measured until 2026-08-25, so a re-tuned gap would
         * have surfaced as a pixel diff on `button-with-icons` — which says a
         * screenshot changed — rather than as `columnGap: 8px -> 12px`, which
         * says what moved. Its own probe rather than extra properties on the one
         * above, because asking an `svg` for its `columnGap` records `normal`
         * three times and calls it a measurement.
         */
        story: 'foundations-control-scale--icon-normalisation',
        label: 'the gap between a glyph and its label is the system\'s too',
        selectors: {
            'gap in button[md]': ".ds-button[data-size='md'] .ds-button__content",
            'gap in button[sm]': ".ds-button[data-size='sm'] .ds-button__content",
            'gap in button[lg]': ".ds-button[data-size='lg'] .ds-button__content",
        },
        properties: ['columnGap'],
    },
    {
        /*
         * The native-table contract, measured because the roadmap approves a
         * native `<table>` for editable matrices and per-row interactive rows —
         * and because on 2026-08-25 seven of the eleven that use that permission
         * turned out to reference no `--ds-table-*` role at all, with three
         * different inline cell paddings between them. These are the numbers that
         * make the two kinds of table one table.
         */
        story: 'patterns-native-table--editable-matrix',
        label: 'a native table is the same table as DataTable',
        selectors: {
            // The surface is on the ROW; a header cell is transparent, so
            // measuring the cell's background would record nothing useful.
            'nativeTable.headerRow': '.ds-native-table thead tr',
            'nativeTable.headerCell': '.ds-native-table thead th',
            'nativeTable.cell': '.ds-native-table tbody td',
        },
        properties: ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'backgroundColor', 'height'],
    },
    {
        /*
         * The frozen first column, measured because it is the one cell in a native
         * table that must NOT be transparent. The surface is painted on the row,
         * so a `position: sticky` cell with no background of its own lets the
         * scrolled columns paint straight through it — which is what happened to
         * the Super Admin feature matrix when its hand-picked `bg-ds-surface` was
         * removed in favour of the contract, and what a review on 2026-08-25
         * caught. An `rgba(0, 0, 0, 0)` here is the regression.
         */
        story: 'patterns-native-table--sticky-first-column',
        label: 'a frozen column is opaque',
        selectors: {
            'stickyTable.headerCell': '.ds-native-table thead th.sticky',
            'stickyTable.rowHeader': '.ds-native-table tbody th.sticky',
        },
        properties: ['backgroundColor', 'position', 'left'],
    },
    {
        story: 'patterns-page-states--full-page-states',
        label: 'the three page states are the same shape as each other',
        selectors: {
            state: '.ds-page-state',
            title: '.ds-page-state__title',
            description: '.ds-page-state__description',
        },
        properties: ['padding', 'fontSize', 'maxWidth'],
    },
];
