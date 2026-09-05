/**
 * The rules that read STRUCTURE rather than text.
 *
 * Split out of `rules.mjs` on 2026-09-05, when `hand-rolled-disclosure` took
 * that file past the 500-line maximum. The boundary is one `rules.mjs` already
 * drew in its own header and is the reason the two halves are genuinely
 * different subjects: everything there is a global regex over source text, and
 * everything here declares `pattern: null` because a regex cannot express it.
 *
 * What they need instead is the tag scanner in `./counting.mjs` — the open tag
 * read with its braces balanced, the element's own name, sometimes what it
 * contains or what contains it. Each of these carries the measurement that
 * decided its scope, because in every one of these cases the obvious scope was
 * measured and found wrong:
 *
 * - `hand-rolled-avatar` reads what a disc HOLDS. A shape-only rule matched 25
 *   elements of which 8 were avatars.
 * - `hand-rolled-current` stays on `<button>`. Three non-interactive
 *   `aria-current` sites are correct markup with no primitive behind them.
 * - `hand-rolled-toggle` reads the open tag, so a `<Button aria-pressed>` at
 *   nineteen correct call sites stays silent.
 * - `hand-rolled-disclosure` requires the enclosing HEADING. Eleven live
 *   `aria-expanded` sites, and only one of them is a disclosure.
 *
 * That is the pattern worth keeping if these are ever rewritten: **a rule that
 * points at a primitive must be scoped to what the primitive actually
 * replaces**, and the way to find that scope is to run the candidate rule over
 * the real tree and read every match.
 *
 * Deliberately no imports from the counting layer, same as `rules.mjs`: these
 * are dispatched by name there, which is what keeps both tables free of a cycle.
 */

export const STRUCTURAL_RULES = [
    {
        /*
         * Nine primitives throw `TypeError` on a label that is not a non-empty
         * string — `FormField`, `FieldDisplay`, `Checkbox`, `Radio`, `Switch`,
         * `IconButton`, `IconButtonLink`, `FileInput`, `ProgressBar`. That is the
         * right contract: an unlabelled control is the defect they exist to
         * prevent, and a silent fallback would hide it.
         *
         * The cost is that passing JSX — usually to sneak a decorative icon in
         * beside the words — is a CRASH, not a downgrade, and only at the moment
         * that branch renders. `DashboardToolbar`'s filter panel carried one for
         * ten migration slices: it sits behind a toggle, the component had no
         * tests, and nothing in the e2e suite clicked Filters. A review bot found
         * it, not this file, which is why the rule now exists.
         *
         * Put the icon next to the control instead of inside its label.
         */
        name: 'jsx-label-on-throwing-primitive',
        // counted by `countJsxLabelsOnThrowingPrimitives`, which needs the tag scanner
        pattern: null,
        remedy: 'These primitives throw on a label that is not a non-empty string, so JSX here '
            + 'is a runtime crash the moment the branch renders. Pass the words as a string and '
            + 'put the icon beside the control, not inside its label.',
    },
    {
        /*
         * A hand-built file picker. `FileInput` shipped for exactly these, and
         * two of the nine that existed had been a `<div onClick>` driving a
         * `display: none` input — which has no keyboard path to the picker at
         * all. The old `hand-styled-field` rule could never see them, because a
         * hidden input carries no styling signal.
         */
        name: 'raw-file-input',
        pattern: null, // counted by `countFileInputs`, which needs the tag scanner
        remedy: 'Use `FileInput`. A `display: none` input behind a `<div onClick>` has no '
            + 'keyboard path to the picker; `FileInput` is a real focusable input behind a '
            + '`<label>`. Upload semantics, accepted types and size limits stay at the call site.',
    },
    {
        /*
         * A disc standing for a person.
         *
         * Scoped by what the disc HOLDS rather than by its shape, because the
         * shape alone is shared by five different components — see
         * `countHandRolledAvatars` for the measurement that settled it. The
         * seventeen non-avatar discs in this tree are `StatusMedallion`'s, a
         * count badge's, a step marker's and a radio dot's business; demanding
         * `Avatar` for any of them would be the rule naming the wrong remedy.
         */
        name: 'hand-rolled-avatar',
        pattern: null,
        remedy: 'Use `Avatar`. It owns the size scale (20/32/40/48/64, the steps GitHub '
            + 'Primer publishes), the tone, and `aria-hidden` — an initial beside the name '
            + 'it abbreviates is noise to a screen reader, and five of the eight discs this '
            + 'replaced were announcing one. A disc holding a GLYPH is `StatusMedallion`.',
    },
    {
        /*
         * "Which one of this set you are on" — a page, a step, a location.
         *
         * A sibling of `hand-rolled-toggle` and a different question: `pressed`
         * says whether one thing is on, `current` says which of several you are
         * looking at. An element claiming both tells assistive technology two
         * stories about itself, which is why `SelectableCard` refuses the pair.
         *
         * `<button>` only. The three non-interactive `aria-current` sites in the
         * tree are correct markup for a progress display with no primitive
         * behind it; see `countHandRolledCurrent` for the measurement and why
         * roadmap section 5 is the right place for that rather than a rule.
         */
        name: 'hand-rolled-current',
        pattern: null,
        remedy: 'Use `SelectableCard` with `current` for one option of a set, or '
            + '`SectionNavigation` for a navigation rail. A step indicator that is read '
            + 'rather than operated has no primitive yet — see the roadmap gap table.',
    },
    {
        /*
         * A two-state control the design system already builds.
         *
         * Counter-backed rather than a regex, for the reason `openTagAttributes`
         * exists at all: the shape has to be read off the OPEN TAG, so that a
         * `<Button aria-pressed>` — nineteen live call sites, all correct — is
         * silent while a raw `<button aria-pressed>` is not. A regex over the
         * attribute alone cannot tell those apart, and one that tried to match
         * `<button[^>]*aria-pressed` would stop at the first `>` inside an arrow
         * function, which is the defect this module records twice already.
         *
         * `<a aria-pressed>` counts too. It is invalid ARIA — a link goes
         * somewhere, it is not on or off — so the rule catching it is a bonus
         * rather than the point. `Chip` refuses the same combination at runtime.
         *
         * Scope is the two elements the design system has primitives for. A
         * `<div role="button" aria-pressed>` is a different and rarer mistake,
         * and inventing coverage for a shape nobody has written would be a rule
         * nobody could test against a real file.
         */
        name: 'hand-rolled-toggle',
        pattern: null,
        remedy: 'Use `Chip` for a filter or a tag, `SegmentedControl` for a set of cards, or '
            + '`Button`/`IconButton` with `pressed` for a toggle that keeps its variant. '
            + 'Wrap a set in `ChipGroup` so the group is named — "pressed" alone does not say '
            + 'what was chosen.',
    },
    {
        /*
         * A titled collapsible section the design system already builds.
         *
         * Scoped to a `<button aria-expanded>` INSIDE A HEADING, and the scope is
         * the whole rule. "A raw `<button aria-expanded>`" was written first and
         * measured at **two elements in the tree** — the one this replaced and a
         * bottom app-bar tab that would then have needed a recorded reason to buy
         * it off. Meanwhile the eleven live `aria-expanded` sites are mostly not
         * disclosures: four menu triggers, a combobox (where the attribute sits on
         * an `<input>`), a navigation group, a drawer trigger, a filter toggle, a
         * row expander. `Disclosure` replaces none of them and nine are already on
         * `Button` or `IconButton`.
         *
         * The heading is what separates the one from the ten. A disclosure
         * *section* puts its trigger inside one so the section reaches the
         * document outline — the WAI-ARIA Authoring Practices shape, and the shape
         * `Disclosure` renders. So the other ten are left alone by their own
         * structure rather than by an exemption list.
         *
         * That is also why this needs no entry in `CONTRACT_EXEMPT_RULES`, unlike
         * the two rules whose primitives ARE the shape they point at:
         * `Disclosure.jsx` renders `<Heading>`, a capitalised binding for the
         * caller's level, and the counter reads lowercase `h1`-`h6` only.
         */
        name: 'hand-rolled-disclosure',
        pattern: null,
        remedy: 'Use `Disclosure` — `variant="card"` for a titled section inside a `Card`, '
            + 'the default for a sidebar rail. A menu, combobox, drawer or sheet trigger is '
            + 'not this: those wear `aria-expanded` too and belong on `Button`/`IconButton`.',
    },
];
