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
 *
 * This file holds the probes for a COMPONENT'S OWN CHROME. The foundation and
 * pattern probes moved to `./probes-system.mjs` on 2026-09-05 — they ask about
 * the shared scales beneath the components and the compositions above them,
 * which is a different question. Both are merged into `PROBES` below, so
 * nothing downstream knows about the split.
 */
import { SYSTEM_PROBES } from './probes-system.mjs';

const COMPONENT_PROBES = [
    {
        story: 'components-notice--tones',
        label: 'the notice chrome, and the six tints that replaced 66 hand-built blocks',
        /*
         * Every property here is one that had DRIFTED across the 66 hand-built
         * notices the 6a audit found — different radii, different padding,
         * different gaps, different glyph sizes — while every one of them used
         * correct `--ds-*` colour roles. That is the whole point of this probe:
         * the colours were never the problem and no colour rule would have
         * caught any of it.
         *
         * All six tones are read, not one. A tone whose border stops resolving
         * renders as a borderless tinted block, which looks deliberate.
         */
        selectors: Object.fromEntries(
            ['neutral', 'info', 'success', 'warning', 'danger', 'accent'].map(
                (tone) => [`notice[${tone}]`, `.ds-notice[data-tone='${tone}']`],
            ),
        ),
        properties: [
            'borderTopWidth', 'borderTopColor', 'borderRadius', 'paddingTop',
            'backgroundColor', 'color', 'alignItems', 'columnGap',
        ],
    },
    {
        story: 'components-notice--compact',
        label: 'the compact notice, which must differ from the default in three places only',
        /*
         * `sm` exists for a notice inside an already-tight panel, and the risk
         * with a second size is that it drifts into being a second design. It
         * changes padding, gap and type size — and nothing else. The glyph
         * shrinks with it, which is read here rather than assumed.
         */
        selectors: {
            'compact': '.ds-notice[data-size=\'sm\']',
            'compact-icon': '.ds-notice[data-size=\'sm\'] .ds-notice__icon',
        },
        properties: [
            'paddingTop', 'columnGap', 'fontSize', 'borderRadius', 'width', 'height',
        ],
    },
    {
        story: 'components-sectionnavigation--wizard-steps',
        label: 'the step rail: a third column, two status colours, and no frame',
        /*
         * `gridTemplateColumns` is the reason this probe exists, and the reason
         * the third track is scoped to `[data-status]` rather than declared on
         * every item. Measured in Chromium before the decision: an `auto` third
         * track costs **12px of label width even while empty**, because grid
         * places its gap between every declared track — 268px became 256px.
         * Unscoped, `SuperAdminSidebar` and `CompanySettings` would each have
         * quietly lost a `--ds-space-3` per row, which no screenshot of either
         * would have made anyone question.
         *
         * So both templates are read: the step item's three tracks, and — in the
         * probe below — the ordinary item's two, unchanged.
         */
        selectors: {
            'frameless': ".ds-section-navigation[data-frame='none']",
            'step-item': ".ds-section-navigation__item[data-status='complete']",
            'complete': ".ds-section-navigation__item[data-status='complete'] .ds-section-navigation__status",
            'incomplete': ".ds-section-navigation__item[data-status='incomplete'] .ds-section-navigation__status",
        },
        properties: [
            'gridTemplateColumns', 'borderTopWidth', 'borderRadius', 'paddingTop',
            'backgroundColor', 'boxShadow', 'color', 'width', 'height',
        ],
    },
    {
        story: 'components-sectionnavigation--with-icons',
        label: 'the page rail the step variant must not have moved',
        /*
         * The other half. Every step rule is scoped under `[data-status]` or
         * `[data-frame='none']`, and an ordinary rail renders neither — asserted
         * here rather than assumed, because a template widened by one track is
         * exactly the kind of change that looks like nothing in a screenshot.
         */
        selectors: {
            'item': '.ds-section-navigation__item',
            'frame': '.ds-section-navigation',
        },
        properties: [
            'gridTemplateColumns', 'minHeight', 'borderTopWidth', 'borderRadius',
            'paddingTop', 'backgroundColor', 'boxShadow',
        ],
    },
    {
        story: 'components-disclosure--card-variant',
        label: 'the card disclosure, and the rail chrome it takes off',
        /*
         * Every one of these is a property the rail sets and the card variant
         * has to override — and an override that stops resolving looks exactly
         * like the design working. The trigger's `paddingLeft` is the one a
         * screenshot would never catch at a glance: the rail's `space-4` inset
         * inside a `Card`'s own padding reads as a slightly indented header
         * rather than as a broken one.
         *
         * `fontWeight` is on the list for the reason the stylesheet spells it
         * `inherit`: the description sits inside the trigger and must not come
         * out bold. Reading the TITLE's weight and the DESCRIPTION's separately
         * is what proves the two did not collapse into one.
         */
        selectors: {
            'section': '.ds-disclosure[data-variant=\'card\']',
            'trigger': '.ds-disclosure[data-variant=\'card\'] .ds-disclosure__trigger',
            'title': '.ds-disclosure[data-variant=\'card\'] .ds-disclosure__title',
            'description': '.ds-disclosure[data-variant=\'card\'] .ds-disclosure__description',
            'chevron': '.ds-disclosure[data-variant=\'card\'] .ds-disclosure__chevron',
            'panel': '.ds-disclosure[data-variant=\'card\'] .ds-disclosure__panel',
        },
        properties: [
            'paddingLeft', 'fontSize', 'fontWeight', 'textTransform', 'letterSpacing',
            'width', 'height', 'color', 'marginTop', 'borderBottomWidth',
        ],
    },
    {
        story: 'components-disclosure--default',
        label: 'the rail disclosure the card variant must not have moved',
        /*
         * The other half of the same contract. Every card rule is scoped under
         * `[data-variant=\'card\']` and the rail renders no such attribute, so
         * the rail should read exactly as it did before the variant existed —
         * asserted here rather than assumed, because "I scoped it correctly" is
         * the claim a specificity accident quietly falsifies.
         */
        selectors: {
            'trigger': '.ds-disclosure:not([data-variant]) .ds-disclosure__trigger',
            'chevron': '.ds-disclosure:not([data-variant]) .ds-disclosure__chevron',
        },
        properties: [
            'paddingLeft', 'minHeight', 'fontSize', 'fontWeight', 'textTransform',
            'letterSpacing', 'width', 'height',
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
        /*
         * `selected` and `current` are one visual state and two ARIA states, and
         * that is a decision worth measuring rather than trusting. If they ever
         * drift apart visually, a person picking a page and a person picking a
         * record start learning two different meanings for the same rail — and a
         * screenshot of two different stories would never show it, because
         * nothing puts them side by side.
         */
        story: 'components-selectablecard--selectable',
        label: 'the selected card, whose ring is a ring rather than a thicker border',
        selectors: {
            'selectableCard[on]': ".ds-selectable-card[data-state='on']",
            'selectableCard[off]': ".ds-selectable-card:not([data-state])",
        },
        properties: ['borderTopWidth', 'boxShadow', 'borderRadius', 'backgroundColor'],
    },
    {
        story: 'components-selectablecard--current-of-a-set',
        label: 'the current card reads exactly as the selected one',
        selectors: {
            'selectableCard[current]': ".ds-selectable-card[data-state='on']",
        },
        properties: ['borderTopWidth', 'boxShadow', 'borderTopColor', 'backgroundColor'],
    },
    {
        /*
         * The whole point of the responsive step, measured at both widths
         * because that is the only way to see it: this probe runs at 412 and
         * 1440, so one snapshot entry reads 48px and the other 64px from the
         * SAME element. A single-width check would pass over a media query that
         * had stopped applying, and the dossier header would quietly become one
         * size everywhere — which is the change this slice researched and
         * decided against.
         */
        /*
         * The claim the inline variant rests on: it changes the CHROME and
         * leaves the control scale alone. If a future edit gave the variant its
         * own height it would drift off the scale silently — the field would
         * still look fine on its own and would stop lining up with the button
         * beside it, which is the failure `.ds-form-control`'s own comment
         * records from when `md` was 40px against a 44px input.
         */
        story: 'components-form-structure--inline-in-chips',
        label: 'the inline field keeps the control height and drops only the box',
        selectors: {
            'input[inline,compact]': ".ds-form-control[data-variant='inline'][data-width='compact']",
            'input[inline,auto]': ".ds-form-control[data-variant='inline']:not([data-width])",
            'input[default]': ".ds-form-control:not([data-variant])",
        },
        properties: ['height', 'borderTopColor', 'backgroundColor', 'width'],
    },
    {
        story: 'components-avatar--responsive-header',
        label: 'the avatar that is two sizes, and only a two-width probe can tell',
        selectors: {
            'avatar[lg→xl]': ".ds-avatar[data-size='lg'][data-size-sm='xl']",
        },
        properties: ['width', 'height', 'fontSize'],
    },
    {
        /*
         * The scale as numbers, because it is a claim about matching published
         * systems rather than a matter of taste: these five are GitHub Primer's
         * avatar steps. A step that drifted would still look fine and would no
         * longer be the standard the README cites.
         */
        story: 'components-avatar--sizes',
        label: 'the five steps, which are Primer\'s steps',
        selectors: Object.fromEntries(
            ['xs', 'sm', 'md', 'lg', 'xl'].map((step) => [`avatar[${step}]`, `.ds-avatar[data-size='${step}']`]),
        ),
        properties: ['width', 'height'],
    },
    {
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
];

/**
 * One table, whatever it is spelled across. The checker asks for the probes
 * and gets all of them, in component-then-system order.
 */
export const PROBES = [...COMPONENT_PROBES, ...SYSTEM_PROBES];
