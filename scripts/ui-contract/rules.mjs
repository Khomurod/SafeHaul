/**
 * The rule tables — what the contract actually forbids.
 *
 * Three sets, because they read different things: `RULES` over JSX and JS,
 * `CSS_RULES` over stylesheets, and `STYLED_CONTROL_RULES` over semantic HTML
 * wearing hand-written styling. Each entry carries its own `remedy`, which is
 * what the failure output prints — a rule that cannot say what to do instead is
 * a rule people route around.
 *
 * Deliberately no imports from the counting layer: entries whose `count` needs
 * the tag scanner declare `pattern: null` and are dispatched by name there, which
 * is what keeps this table free of a cycle.
 */

export const TAILWIND_PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
export const COLOR_PREFIX = 'bg|text|border|ring|from|to|via|divide|placeholder|decoration|outline|accent|caret|fill|stroke|shadow';

/**
 * A rule is a name, a global regex, and the sentence a developer needs to read
 * when it fires. The message is the whole point: a guard that says only "failed"
 * teaches nothing and gets an exemption added instead of a fix.
 */
export const RULES = [
    {
        name: 'raw-palette-class',
        pattern: new RegExp(`\\b(?:${COLOR_PREFIX})-(?:${TAILWIND_PALETTE})-\\d{2,3}\\b`, 'g'),
        remedy: 'Use a `--ds-*` semantic role (`bg-ds-surface`, `text-ds-content-secondary`, '
            + '`border-ds-border`). If no role fits, add one to `tokens/semantic.css` with '
            + 'contrast evidence — do not reach past the contract.',
    },
    {
        name: 'raw-hex-colour',
        /*
         * Four shapes, because a colour is written four ways here and the rule
         * saw two of them until 2026-09-05.
         *
         *   1. an arbitrary-value class      `bg-[#ff0000]`
         *   2. a CSS-ish declaration          `color: #ff0000`
         *   3. an SVG presentation ATTRIBUTE  `fill="#004C68"`      <- was invisible
         *   4. a JS assignment                `ctx.strokeStyle = '#333'`  <- was invisible
         *
         * Shapes 3 and 4 are how every remaining raw colour in this tree is
         * spelled, which is why the guard reported none of them: the logo, the
         * loader and the favicon carried the brand hexes as attributes, and the
         * signature pads assign theirs to a canvas context. Widening the rule to
         * cover them found four live sites the inventory had never recorded.
         *
         * `#` is not always a colour, so the shapes are deliberately narrow:
         * attribute matching is limited to the presentation attributes that take
         * one, which keeps `href="#main"` and `placeholder="#1234567"` out; and
         * assignment matching needs a quoted hex on the right of an `=`, which
         * keeps `url(#id)`, `currentColor`, `none` and `var(--…)` out.
         */
        pattern: new RegExp([
            String.raw`(?:bg|text|border|ring|fill|stroke|shadow)-\[#[0-9a-fA-F]{3,8}\]`,
            String.raw`(?:color|background|border|fill|stroke)\s*:\s*['"]?#[0-9a-fA-F]{3,8}\b`,
            String.raw`\b(?:fill|stroke|stopColor|stop-color|floodColor|flood-color`
                + String.raw`|lightingColor|lighting-color|color)\s*=\s*["']#[0-9a-fA-F]{3,8}["']`,
            String.raw`(?:^[ \t]*|\b(?:const|let|var)\s+)[\w.$]+\s*=\s*['"]#[0-9a-fA-F]{3,8}['"]`,
        ].join('|'), 'gm'),
        remedy: 'Use a `--ds-*` semantic role. An exported document or a brand asset that '
            + 'genuinely cannot resolve a custom property is an exception — record it.',
    },
    {
        name: 'bare-tailwind-radius',
        /*
         * `rounded` with no scale step — Tailwind's default, which is 4px.
         *
         * The `tailwind-radius` rule above catches `rounded-lg` and friends, but
         * a bare `rounded` slipped past it entirely, and bare is the commonest
         * way to write "just round it a bit". 17 of them across 6 files.
         *
         * The lookbehind is what makes this usable: without it the pattern also
         * matches the tail of `surrounded`, and the lookahead keeps
         * `rounded-ds-md` and `rounded-full` out — those are the scale being used
         * correctly, and a rule that fires on correct code gets switched off.
         * The optional side group covers `rounded-t`, `rounded-bl` and the
         * logical-property spellings, which are equally scale-less.
         */
        pattern: /(?<![\w-])rounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?(?![\w-])/g,
        remedy: 'A bare `rounded` is Tailwind\'s 4px default, which is not a step on the '
            + '`--ds-radius-*` scale. Name the step you mean: `rounded-ds-sm` is the closest.',
    },
    {
        name: 'bare-tailwind-shadow',
        /*
         * The same gap for elevation. `shadow` alone is Tailwind's default step.
         * The lookbehind excludes `transition-shadow`, which is an animation
         * property rather than an elevation, and the lookahead excludes every
         * `shadow-*` the sibling rule already reads.
         */
        pattern: /(?<![\w-])shadow(?![\w-])/g,
        remedy: 'A bare `shadow` is Tailwind\'s default elevation, which is not a step on the '
            + '`--ds-shadow-*` scale. Name the step: `shadow-ds-xs` is the closest.',
    },
    {
        name: 'raw-black-white-class',
        /*
         * Pure black and pure white, which the palette rule misses because they
         * carry no numeric step. The optional `/NN` covers the opacity forms —
         * `bg-black/20` is how nearly every one of these is actually written.
         */
        pattern: new RegExp(`\\b(?:${COLOR_PREFIX})-(?:black|white)(?:/\\d{1,3})?(?![\\w-])`, 'g'),
        remedy: 'Pure black and pure white are not roles. Use `bg-ds-surface`, '
            + '`text-ds-content-on-inverse` or the inverse surface roles. An opacity wash over '
            + 'one needs a semantic token declared as `rgb(… / a)` in `tokens/semantic.css` '
            + '(see `--ds-color-brand-accent-soft`), not a slash suffix on a raw colour.',
    },
    {
        name: 'sub-12px-type',
        pattern: /text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g,
        remedy: 'The interface floor is 12px (`text-ds-xs`). This has been the written rule '
            + 'since the beginning and was never enforced, which is why 26 of them exist.',
    },
    {
        name: 'off-scale-type',
        // Tailwind's own scale (12/14/18/20…) is not the `--ds-*` scale
        // (12/13/14/15/16/18/20/24), so mixing them *is* the inconsistent typography.
        pattern: /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)\b/g,
        remedy: 'Use the `--ds-*` type scale (`text-ds-xs|sm|body|body-lg|heading-sm|'
            + 'heading-md|heading-lg|heading-xl`). Tailwind\'s scale is a different set of '
            + 'sizes, so a screen mixing both has two type systems on it.',
    },
    {
        name: 'arbitrary-type-size',
        pattern: /text-\[[0-9.]+(?:rem|em)\]|text-\[(?:1[2-9]|[2-9]\d)(?:\.\d+)?px\]/g,
        remedy: 'Add the size to the type scale if it is genuinely needed, or use the nearest '
            + 'scale step. An arbitrary size is a new type scale of one.',
    },
    {
        /*
         * Tailwind's radius scale and the `--ds-*` one share names and are
         * offset by one step: `rounded-lg` is 8px, `rounded-ds-lg` is 12px.
         * That makes this worse than an arbitrary value — the name actively
         * misleads, and the two rendered side by side in the same product for
         * the whole of 2026 without anyone noticing. Convert by *value*, not by
         * name: rounded → ds-sm, rounded-lg → ds-md, rounded-xl → ds-lg,
         * rounded-2xl → ds-xl, rounded-full → ds-full.
         */
        name: 'tailwind-radius',
        pattern: /\brounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?-(?:sm|md|lg|xl|2xl|3xl|full)\b/g,
        remedy: 'Use the `--ds-*` radius scale, and match it by value rather than by name: '
            + 'Tailwind\'s `rounded-lg` is 8px but `rounded-ds-lg` is 12px. `rounded` → '
            + '`rounded-ds-sm`, `rounded-lg` → `rounded-ds-md`, `rounded-xl` → `rounded-ds-lg`, '
            + '`rounded-2xl` → `rounded-ds-xl`, `rounded-full` → `rounded-ds-full`.',
    },
    {
        /*
         * Same offset, same trap. Tailwind's `shadow-sm` is the `--ds-shadow-xs`
         * step, and every Tailwind shadow is pure black where the `--ds-*` ones
         * are tinted with the slate the rest of the product is built from.
         */
        name: 'tailwind-shadow',
        pattern: /\bshadow-(?:sm|md|lg|xl|2xl|inner)\b/g,
        remedy: 'Use the `--ds-*` shadow scale, matched by value: Tailwind\'s `shadow-sm` is '
            + 'the `shadow-ds-xs` step. Tailwind\'s shadows are pure black; the `--ds-*` ones '
            + 'are tinted with the same slate as the rest of the product.',
    },
    {
        name: 'hand-built-overlay',
        pattern: /fixed inset-0/g,
        /*
         * Passing `overlayClassName` to `Modal` is the approved way to position a
         * dialog, and those values legitimately contain `fixed inset-0` — the
         * roadmap says a scan should return `Modal` itself *and* its
         * `overlayClassName` callers. Counting them would have made this rule fire
         * on 20 correct call sites, and a check that flags correct code gets
         * switched off. `prepare` removes those attribute values before matching,
         * so what is left is a genuinely hand-built overlay.
         */
        prepare: (code) => code.replace(/overlayClassName\s*=\s*(?:"[^"]*"|'[^']*'|\{`[^`]*`\}|\{[^}]*\})/g, 'overlayClassName={…}'),
        remedy: 'Every overlay goes through `Modal` from `@design-system/patterns`. Passing it '
            + 'an `overlayClassName` is fine; building the backdrop yourself is not — that is '
            + 'how a dialog ends up with no role, no focus trap and no Escape.',
    },
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
        name: 'raw-table',
        pattern: /<table\b/g,
        remedy: 'Use `DataTable` for a display table. An editable matrix or a per-row '
            + 'interactive grid may keep a native table — the roadmap approves that pattern '
            + 'by path — but it must then apply `ds-native-table`, which is what gives it the '
            + 'same header, divider, density and cell padding as `DataTable`.',
    },
    {
        /*
         * A hand-rolled tab strip.
         *
         * `TabList` / `TabPanel` shipped on 2026-08-21 precisely because nine
         * screens had written this by hand and seven had each written the same
         * `handleTabKeyDown`. Nothing checked, so four days later the primitive
         * still had zero consumers and all eleven strips were still there — in
         * three different visual treatments, several sizing their own icons.
         *
         * A rule, not a roadmap line, is the difference.
         */
        name: 'hand-rolled-tablist',
        pattern: /role=["']tablist["']/g,
        remedy: 'Use `TabList` / `TabPanel` from `@design-system/components`. They carry the '
            + 'roving `tabIndex`, the arrow/Home/End handling, the `aria-controls` pairing via '
            + '`tabIds`, the shared control height and the icon size. `variant="pill"` and '
            + '`fitted` cover the strip shapes the product actually uses.',
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
         * `target="_blank"` written by hand.
         *
         * `Link`, `ButtonLink` and `IconButtonLink` take `external`, which sets
         * the target, sets the `rel` that closes the reverse-tabnabbing hole,
         * AND appends the hidden "opens in a new tab" hint. Writing the target
         * by hand gets the first two at best and silently drops the third, which
         * is a WCAG 3.2.5 failure. Three of these were still live after the
         * campaign that built the primitive to fix them.
         */
        name: 'hand-written-target-blank',
        pattern: /target=["']_blank["']/g,
        remedy: 'Pass `external` to `Link` / `ButtonLink` / `IconButtonLink` instead. That is '
            + 'the only form that announces the new tab; `target` plus `rel` written by hand '
            + 'does not (WCAG 3.2.5).',
    },
];

/**
 * The rules that mean something in a stylesheet.
 *
 * CSS went unscanned until 2026-08-25, and `src/shared/styles/designTokens.css`
 * spent the whole campaign there — a second colour, type, radius, shadow and
 * spacing scale in forty-odd raw hexes — completely invisible to a guard the
 * README described as zero-tolerance.
 */
export const CSS_RULES = [
    {
        name: 'css-raw-colour',
        pattern: /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g,
        remedy: 'Reach a `--ds-*` role with `var()`. Colour is declared in '
            + '`tokens/foundation.css` and given meaning in `tokens/semantic.css`; those two '
            + 'are the only files allowed to name a colour, and they are exempt by path.',
    },
    {
        name: 'css-sub-12px-type',
        pattern: /font-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px\b/g,
        remedy: 'The interface floor is 12px. Use `var(--ds-font-size-xs)` or a larger step.',
    },
];

export const CSS_RULE_NAMES = CSS_RULES.map((rule) => rule.name);

/**
 * Styled controls are counted separately, because the regex has to look at the
 * element *and* its class list to tell a semantic `<button>` (fine) from a
 * hand-built one wearing padding and a background (not fine).
 */
export const STYLED_CONTROL_RULES = [
    {
        name: 'hand-styled-button',
        element: 'button',
        remedy: 'Use `Button` or `IconButton`. A `<button>` with no styling of its own is fine '
            + '— a tab, a disclosure trigger, a cell affordance. One carrying its own padding, '
            + 'background or border is a second button contract.',
    },
    {
        name: 'hand-styled-field',
        element: 'input|select|textarea',
        remedy: 'Use `Input`, `Select`, `Textarea` or `FileInput`, wrapped in `FormField`. '
            + 'A hand-styled control will not match the shared control height, so it will not '
            + 'line up with the button beside it.',
    },
    {
        name: 'hand-styled-anchor',
        element: 'a',
        remedy: 'Use `Link`, `ButtonLink` or `IconButtonLink`. Pass `external` rather than '
            + 'writing `target="_blank"` — that is how the new tab gets announced.',
    },
];

/**
 * A class list that decides geometry or colour, rather than just layout.
 *
 * `-ds-` is accepted after a spacing prefix as well as a digit: `px-ds-3` is
 * every bit as much a hand-picked inline padding as `px-3`, and listing only the
 * digit form let a control styled entirely in `--ds-*` utilities through.
 */
export const STYLING_SIGNAL = /\b(?:p|px|py|pt|pb|pl|pr)-(?:\d|ds-)|\bbg-|\bborder(?:-|\b)|\brounded|\btext-(?:xs|sm|base|lg|xl)|\bh-\d|\bmin-h-/;

/**
 * Every JSX open tag for `name`, returned as its raw attribute text.
 *
 * ## Why this is not a regex
 *
 * It was, and the regex was `<(button)\b([^>]*)>`. `[^>]*` stops at the first
 * `>` — **including the one in `=>`** — so a control written the ordinary React
 * way,
 *
 *     <button onClick={() => go()} className="bg-ds-surface border px-3">
 *
 * had its attribute text truncated at `onClick={() =` and therefore contained no
 * `className`, and the rule silently passed. Only controls whose `className`
 * happened to come *before* any arrow function were ever checked.
 *
 * Measured on 2026-08-25: the regex saw 12 hand-styled controls in 8 files. This
 * scanner sees 49 in 32. The guard the README called zero-tolerance had been
 * inspecting a quarter of the tree.
 *
 * So the tag end has to be found by actually tracking expression containers and
 * quotes, which is what this does. It is not a JSX parser and does not need to
 * be: it needs to find the `>` that closes the open tag, and nothing shorter
 * than brace-and-quote tracking finds it reliably.
 */
