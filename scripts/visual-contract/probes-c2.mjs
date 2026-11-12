/**
 * The C2 redesign's decisions, measured (owner approval, 2026-11).
 *
 * A file of its own because these probes answer one question together — is the
 * company workspace still drawn the way the owner approved it? — and because
 * `probes.mjs` is near the size limit. They are merged into `PROBES` there, so
 * nothing downstream knows about the split.
 *
 * Every property is read at both widths. Where a value must DIFFER between the
 * widths (the page header is a wrapping row on a desk and one column on a
 * phone; a sheet only rises from the bottom on a phone), a snapshot where the
 * two agree is the regression.
 */
export const C2_PROBES = [
    {
        /*
         * The page header: the title's size and the eyebrow's look, and the
         * layout that keeps actions beside the title or on a line of their own
         * (flex) on a desk, one column in DOM order (grid) on a phone.
         */
        story: 'components-page-layout--eyebrow-and-back-link',
        label: 'the C2 page header: title step, eyebrow, wrapping lines on a desk',
        selectors: {
            header: '.ds-page-header',
            heading: '.ds-page-header__heading',
            eyebrow: '.ds-page-eyebrow__text',
        },
        properties: ['display', 'fontSize', 'fontWeight', 'color', 'textTransform', 'letterSpacing'],
    },
    {
        /*
         * The tray a page's views and a list's segments share: a 44px bordered
         * tray holding 36px items, the chosen one the inverse surface.
         */
        story: 'components-tabs--segmented',
        label: 'the segmented tray and its chosen item',
        selectors: {
            tray: ".ds-segmented-group[data-variant='segmented']",
            chosen: ".ds-segmented-group[data-variant='segmented'] .ds-segmented-group__item[data-selected]",
        },
        properties: ['height', 'borderTopLeftRadius', 'backgroundColor', 'color', 'fontWeight'],
    },
    {
        /* A notice drawn as a card's last row: no frame of its own, only a top rule. */
        story: 'components-notice--flush-in-card',
        label: 'the flush notice is a card row, not a box',
        selectors: {
            notice: ".ds-notice[data-frame='flush']",
        },
        properties: ['borderTopWidth', 'borderLeftWidth', 'borderTopLeftRadius', 'borderBottomLeftRadius', 'paddingLeft', 'paddingTop'],
    },
    {
        /*
         * The bottom sheet: on a phone the dialog rises from the bottom edge,
         * square below; at a desk it is the ordinary centred dialog. The panel's
         * own bottom padding is 0 — its last row pads the safe area.
         */
        story: 'patterns-modal-chrome--sheet-on-phones',
        label: 'the dialog that is a bottom sheet on a phone',
        selectors: {
            overlay: ".ds-modal[data-mobile='sheet']",
            panel: ".ds-modal[data-mobile='sheet'] .ds-modal__panel",
        },
        properties: ['alignItems', 'borderTopLeftRadius', 'borderBottomLeftRadius', 'paddingBottom'],
    },
    {
        /*
         * The section header's two shapes must not drift into each other: the
         * default inset header with a 13px description, and the full-bleed C2
         * header with a 14px one.
         */
        story: 'components-form-structure--section-with-footer',
        label: 'the full-bleed section header and its footer row',
        selectors: {
            header: '.ds-form-section__header',
            description: '.ds-form-section__description',
        },
        properties: ['marginLeft', 'paddingLeft', 'fontSize'],
    },
    {
        /*
         * The aside layout in a column too narrow for it, at a desk: only a
         * container query can stack it there, so one track here is the proof
         * that the query, not the viewport, decides.
         */
        story: 'components-form-structure--aside-sections-in-narrow-column',
        label: 'the aside layout stacks by its container, not the window',
        selectors: {
            columns: '.ds-form-section__columns',
        },
        properties: ['display', 'gridTemplateColumns'],
    },
    {
        /* A radio card's checked state wears the brand: the C2 role choice. */
        story: 'components-checkbox--radio-cards',
        label: 'the checked radio card',
        selectors: {
            checked: '.ds-choice:has(:checked)',
        },
        properties: ['backgroundColor', 'borderTopColor'],
    },
];
