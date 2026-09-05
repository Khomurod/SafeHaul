/**
 * What gets measured, and at which story.
 *
 * Split out of `scripts/check-visual-contract.mjs` on 2026-09-05, when the two
 * chip probes took that file past the 500-line maximum. The split is by
 * responsibility rather than by line count, and the two halves are genuinely
 * different subjects: this file is a **table of decisions** — which story, which
 * selector, which properties are part of the contract and why — and grows every
 * time the design system decides something. The checker is a browser driver and
 * a snapshot comparison, and does not.
 *
 * Each probe names a story, a selector, and the properties that are part of the
 * contract. Nothing here is incidental: every property is one the campaign
 * decided deliberately and that a careless change would silently undo.
 */
export const PROBES = [
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
        story: 'components-modal--default',
        label: 'the dialog overlay, whose stacking layer is not a caller decision',
        /*
         * `zIndex` is the point. The mobile navigation drawer sits at
         * `--ds-z-modal` too, and every dialog that still replaces its own
         * overlay writes a bare `z-50` — which renders it BEHIND the drawer.
         * Nine hand-written workarounds exist for that. This reading is what
         * stops the contract's own overlay drifting back down.
         */
        selectors: { overlay: '.ds-modal' },
        properties: ['zIndex', 'backgroundColor', 'paddingTop', 'alignItems'],
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
         * The two meanings of `tone`, as numbers.
         *
         * On a `primary` it FILLS; on a `secondary` it TINTS. Until 2026-09-05 a
         * single variant-agnostic rule filled both, so this pair is the whole
         * point of the slice and the thing most likely to be undone by a later
         * edit that "simplifies" the two blocks back into one. A screenshot
         * would say a picture changed; this says `backgroundColor:
         * rgb(22, 163, 74) -> rgb(220, 252, 231)`, which says what changed.
         *
         * It matters more than usual here because the two consumers this slice
         * retired — the envelope editor's field palette and the sandbox Magic
         * Fill — have NO app-screen baseline between them: the editor is not one
         * of the 15 photographed screens and `/sandbox/*` is deliberately
         * excluded as a harness route. Without this probe the migration would
         * rest on unit tests and reading alone.
         */
        story: 'components-button--success-tone',
        label: 'a tone fills a primary and tints a secondary',
        selectors: {
            'primary[success]': ".ds-button[data-tone='success'][data-variant='primary']",
            'secondary[success]': ".ds-button[data-tone='success'][data-variant='secondary']",
        },
        properties: ['backgroundColor', 'color', 'borderColor', 'borderRadius'],
    },
    {
        /*
         * The `xs` step, as a number, because it is a CONFORMANCE claim rather
         * than a taste one: 24px is the WCAG 2.2 SC 2.5.8 (AA) target-size
         * minimum, and the owner chose on 2026-09-05 to meet it on the PDF
         * corner badges themselves rather than lean on the equivalent-control
         * exception. A step that silently drifted to 20px would still look
         * fine and would no longer conform.
         *
         * `height` as well as `width`: `.ds-button` carries
         * `min-height: var(--ds-control-height-md)`, so an `xs` rule that set
         * only the width would leave a 24px-wide, 44px-tall control — under the
         * minimum in neither axis, but the wrong shape and a wasted 20px on a
         * field box. It is the kind of thing only a measurement catches.
         */
        story: 'components-chip--sizes',
        label: 'the chip steps, measured against the controls they claim to match',
        selectors: {
            /*
             * `Chip`'s two sizes are named after the shared control-height steps
             * on the promise that they ARE those steps — `xs` the same 24px as
             * `IconButton size="xs"`, `sm` the same 36px as `Button size="sm"`.
             * A promise in a doc comment is not a promise; this story puts one
             * of each pair beside the other and the probe measures both, so the
             * claim fails here rather than in somebody's misaligned toolbar.
             */
            'chip[xs]': ".ds-chip[data-size='xs']",
            'chip[sm]': ".ds-chip[data-size='sm']",
            'iconButton[xs]:beside-chip': ".ds-icon-button[data-size='xs']",
            'button[sm]:beside-chip': ".ds-button[data-size='sm']:not(.ds-icon-button)",
        },
        properties: ['height', 'borderRadius'],
    },
    {
        /*
         * The pressed state, as geometry rather than colour. The candidate
         * list's sort toggles marked the active direction with a text utility
         * that lost to the variant's own `color` — measured in P-2 as the reason
         * they could not migrate. What replaced it has to keep drawing a ring:
         * `boxShadow` reading `none` on the pressed control is that defect
         * coming back, and it is invisible in a screenshot of a blue-on-blue
         * toggle.
         */
        story: 'components-chip--pressed-controls',
        label: 'the pressed state draws a ring, not only a colour',
        selectors: {
            'iconButton[pressed]': ".ds-icon-button[data-pressed]",
            'button[ghost,pressed]': ".ds-button[data-variant='ghost'][data-pressed]:not(.ds-icon-button)",
        },
        properties: ['boxShadow', 'color', 'backgroundColor'],
    },
    {
        story: 'components-iconbutton--extra-small-and-round',
        label: 'the 24px minimum target, and the disc',
        selectors: {
            'iconButton[xs]': ".ds-icon-button[data-size='xs']:not([data-shape])",
            'iconButton[xs,round]': ".ds-icon-button[data-size='xs'][data-shape='round']",
        },
        properties: ['width', 'height', 'borderRadius'],
    },
    {
        story: 'components-button--link-variant',
        label: 'the one variant that leaves the control scale, and the one that does not',
        selectors: {
            // Pinned because the whole point of `link` is the absence of a box:
            // if a future edit lets the control height back in, every form row
            // carrying one silently grows and the link stops reading as text.
            'button[link]': ".ds-button[data-variant='link']",
            'button[ghost]': ".ds-button[data-variant='ghost']",
        },
        properties: ['height', 'fontSize', 'paddingLeft', 'paddingRight'],
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
        story: 'components-card--padding',
        fallbackStory: 'components-card--default',
        label: 'the surface geometry every card shares',
        selectors: { card: '.ds-card' },
        properties: ['borderRadius', 'padding', 'borderTopWidth', 'backgroundColor'],
    },
    {
        story: 'components-badge--tones',
        fallbackStory: 'components-badge--default',
        label: 'badges hug their label and never stretch',
        selectors: { badge: '.ds-badge' },
        properties: ['height', 'fontSize', 'borderRadius', 'width'],
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
        story: 'components-datatable--default',
        label: 'table density: row height and cell padding',
        selectors: {
            headerCell: '.ds-data-table th',
            bodyCell: '.ds-data-table td',
        },
        properties: ['height', 'paddingLeft', 'paddingRight', 'fontSize'],
    },
    {
        story: 'components-tabs--default',
        label: 'a tab is a control, at the control height',
        selectors: { tab: '.ds-tab' },
        properties: ['height', 'fontSize'],
    },
    {
        story: 'components-switch--states',
        label: 'switch geometry',
        selectors: { switch: '.ds-switch' },
        properties: ['width', 'height', 'borderRadius'],
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
