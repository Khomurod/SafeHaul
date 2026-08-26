#!/usr/bin/env node
/**
 * Repository guard: new UI code cannot casually reintroduce the inconsistencies
 * this design system exists to remove.
 *
 * Run:    `npm run check:ui-contract`
 * Update: `npm run check:ui-contract -- --update`   (after a migration shrinks it)
 *
 * ## Why this exists
 *
 * The design system was substantial and largely adopted, and the application was
 * still visibly inconsistent, because *nothing checked*. A 2026-08 audit of the
 * tree found 364 raw Tailwind palette classes across 49 files, 142 raw type
 * classes competing with the `--ds-*` scale, and 26 pieces of text below the
 * 12px floor the roadmap had forbidden in writing since the beginning. Every one
 * of those passed review, lint, 234 test files and CI.
 *
 * A rule that lives only in a document is a rule that is followed until someone
 * is in a hurry.
 *
 * ## Zero tolerance, with a written allowlist
 *
 * Every violation this finds must appear in
 * `src/design-system/ui-contract.allowlist.json` **with a reason** naming the
 * roadmap entry that justifies it. There is no other way to pass:
 *
 *   - a violation in a file that is not in the allowlist   -> fail
 *   - more violations in a file than the allowlist records -> fail
 *   - fewer                                                -> fail, "run --update"
 *   - an allowlist entry with no reason                    -> fail
 *
 * It began (2026-08-21) as a shrink-only ratchet over an inventory of 660
 * tolerated violations, most tagged with the migration slice that owed the
 * work. The last of that debt cleared on 2026-08-25, so the `debt` escape hatch
 * is gone: an entry without a reason is now an error rather than a promise.
 *
 * Failing on a *decrease* is deliberate too. It keeps the allowlist honest, so
 * it can never quietly describe a tree that no longer exists, and it makes
 * every fix visible in its own diff. `--update` rewrites the file, preserving
 * reasons and dropping the ones whose rule no longer fires.
 *
 * ## What it deliberately does not flag
 *
 * Semantic HTML. A `<button>` is not a violation; a `<button>` wearing
 * hand-written padding and a background colour is. A `<table>` is not a
 * violation; the roadmap approves the native-table pattern for editable
 * matrices, and those are listed by path. A brittle check that fires on correct
 * markup gets switched off, which is worse than no check.
 */

import { parse } from '@babel/parser';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Resolved lazily, not at module scope. `countViolations` and `stripComments`
 * are imported by `src/tests/uiContract.ratchet.test.js` to prove this guard can
 * fail, and Vitest rewrites `import.meta.url` to a non-file URL — computing
 * paths on import made the whole module throw before a single rule could run.
 */
function repoRoot() {
    return fileURLToPath(new URL('..', import.meta.url));
}
function srcRoot() {
    return path.join(repoRoot(), 'src');
}
function allowlistPath() {
    return path.join(srcRoot(), 'design-system/ui-contract.allowlist.json');
}

/* ------------------------------------------------------------------ *
 * Source scanning
 * ------------------------------------------------------------------ */

const isTestFile = (name) => /\.(test|spec)\.[jt]sx?$/.test(name);

/**
 * Stylesheets the token contract is *defined* in, plus the vendored typeface.
 *
 * A raw hex is the whole job of `tokens/foundation.css` — that is where the
 * product's colours are declared, and every other file is supposed to reach them
 * through a `--ds-*` role. So these are exempt by path rather than by allowlist
 * entry: an allowlist number here would have to be updated every time a palette
 * step was added, which trains people to update numbers.
 *
 * Nothing else is exempt. Component stylesheets inside the design system are
 * scanned like feature code, because a hex hard-coded in `Button.css` is the same
 * defect as one hard-coded in a screen.
 */
const TOKEN_DEFINITION_FILES = new Set([
    'design-system/tokens/foundation.css',
    'design-system/tokens/semantic.css',
]);

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(target);
        if (!/\.(?:[jt]sx?|css)$/.test(entry.name)) return [];
        // Tests assert on the very strings these rules forbid.
        if (isTestFile(entry.name)) return [];
        return [target];
    });
}

/**
 * The rules a *story* is held to.
 *
 * Stories used to be skipped entirely, as "catalog furniture already covered by
 * `test:stories`". That reasoning does not hold: `test:stories` runs axe, not
 * this, and a story is the design system's own published example of how to build
 * something — a raw palette class or an off-scale type size in one is being
 * taught, not merely tolerated.
 *
 * So they are scanned, but only for the rules that read a **class list**. The
 * markup-shaped rules are left off deliberately, for two reasons that both apply
 * only to the catalog: a story legitimately *demonstrates* the pattern (the
 * permissions matrix in `Checkbox.stories` is a native `<table>`, which is the
 * approved case for one), and a story's documentation *discusses* it — three of
 * these rules fired on prose like "Do not hand-write `target=\"_blank\"`",
 * because class names live inside string literals so string literals cannot be
 * stripped. Allowlisting a sentence that tells people the right thing would be
 * an inventory entry that teaches nothing.
 */
const STORY_RULE_NAMES = [
    'raw-palette-class',
    'raw-hex-colour',
    'sub-12px-type',
    'off-scale-type',
    'arbitrary-type-size',
    'tailwind-radius',
    'tailwind-shadow',
    'hand-styled-button',
    'hand-styled-field',
    'hand-styled-anchor',
];

/**
 * Which rules apply to a file.
 *
 * Stylesheets get the two rules that mean anything in CSS — a raw colour and
 * sub-12px type — because until 2026-08-25 this guard read only JSX, and
 * `src/shared/styles/designTokens.css` sat there for the whole campaign with a
 * second colour, type, radius and shadow scale in forty-odd raw hexes, entirely
 * invisible to a check the README called zero-tolerance.
 */
export function rulesFor(relativePath) {
    if (relativePath.endsWith('.css')) {
        if (TOKEN_DEFINITION_FILES.has(relativePath)) return [];
        return CSS_RULE_NAMES;
    }
    if (/\.stories\.[jt]sx?$/.test(relativePath)) return STORY_RULE_NAMES;
    return null; // null = every JSX rule
}

/**
 * Strips comments while **keeping string literals**.
 *
 * The opposite of what `noBlockingBrowserDialogs.test.js` needs, and for the
 * opposite reason: a class name lives *inside* a string, so stripping strings
 * would blind every rule here. Comments must still go, because this repository
 * documents the defects it fixed in prose — several files explain the exact
 * `bg-blue-600` they removed, and matching that would report a fix as a
 * violation.
 */
export function stripComments(source) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';

    while (i < source.length) {
        const two = source.slice(i, i + 2);

        if (state === 'code') {
            if (two === '/*') { state = 'block'; i += 2; continue; }
            if (two === '//') { state = 'line'; i += 2; continue; }
            if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
                state = 'string'; quote = source[i]; out += source[i]; i += 1; continue;
            }
            out += source[i]; i += 1; continue;
        }

        if (state === 'block') {
            if (two === '*/') { state = 'code'; i += 2; continue; }
            if (source[i] === '\n') out += '\n';
            i += 1; continue;
        }

        if (state === 'line') {
            if (source[i] === '\n') { state = 'code'; out += '\n'; }
            i += 1; continue;
        }

        // state === 'string' — kept verbatim, including escapes.
        if (source[i] === '\\') { out += source.slice(i, i + 2); i += 2; continue; }
        if (source[i] === quote) { state = 'code'; }
        out += source[i]; i += 1;
    }

    return out;
}

/**
 * Strips `/* … *\/` only.
 *
 * For CSS, because `stripComments` also treats `//` as a line comment — which is
 * correct for JavaScript and wrong for a stylesheet, where `//` appears inside
 * `url(https://…)`. An unquoted URL would blind the rest of the file.
 */
export function stripBlockComments(source) {
    let out = '';
    let i = 0;
    let inComment = false;
    while (i < source.length) {
        const two = source.slice(i, i + 2);
        if (!inComment && two === '/*') { inComment = true; i += 2; continue; }
        if (inComment) {
            if (two === '*/') { inComment = false; i += 2; continue; }
            if (source[i] === '\n') out += '\n';
            i += 1;
            continue;
        }
        out += source[i];
        i += 1;
    }
    return out;
}

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

const TAILWIND_PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOR_PREFIX = 'bg|text|border|ring|from|to|via|divide|placeholder|decoration|outline|accent|caret|fill|stroke|shadow';

/**
 * A rule is a name, a global regex, and the sentence a developer needs to read
 * when it fires. The message is the whole point: a guard that says only "failed"
 * teaches nothing and gets an exemption added instead of a fix.
 */
const RULES = [
    {
        name: 'raw-palette-class',
        pattern: new RegExp(`\\b(?:${COLOR_PREFIX})-(?:${TAILWIND_PALETTE})-\\d{2,3}\\b`, 'g'),
        remedy: 'Use a `--ds-*` semantic role (`bg-ds-surface`, `text-ds-content-secondary`, '
            + '`border-ds-border`). If no role fits, add one to `tokens/semantic.css` with '
            + 'contrast evidence — do not reach past the contract.',
    },
    {
        name: 'raw-hex-colour',
        // In a className or a style value. `#` in a URL or an id selector is not a colour.
        pattern: /(?:bg|text|border|ring|fill|stroke|shadow)-\[#[0-9a-fA-F]{3,8}\]|(?:color|background|border|fill|stroke)\s*:\s*['"]?#[0-9a-fA-F]{3,8}\b/g,
        remedy: 'Use a `--ds-*` semantic role. An exported document or a brand asset that '
            + 'genuinely cannot resolve a custom property is an exception — record it.',
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
const CSS_RULES = [
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

const CSS_RULE_NAMES = CSS_RULES.map((rule) => rule.name);

/**
 * Styled controls are counted separately, because the regex has to look at the
 * element *and* its class list to tell a semantic `<button>` (fine) from a
 * hand-built one wearing padding and a background (not fine).
 */
const STYLED_CONTROL_RULES = [
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
const STYLING_SIGNAL = /\b(?:p|px|py|pt|pb|pl|pr)-(?:\d|ds-)|\bbg-|\bborder(?:-|\b)|\brounded|\btext-(?:xs|sm|base|lg|xl)|\bh-\d|\bmin-h-/;

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
function openTagAttributes(code, name) {
    const out = [];
    const start = new RegExp(`<(?:${name})(?=[\\s/>])`, 'g');
    for (const match of code.matchAll(start)) {
        let i = match.index + match[0].length;
        let depth = 0;
        let quote = '';
        while (i < code.length) {
            const ch = code[i];
            if (quote) {
                if (ch === '\\') { i += 2; continue; }
                if (ch === quote) quote = '';
                i += 1;
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') { quote = ch; i += 1; continue; }
            if (ch === '{') { depth += 1; i += 1; continue; }
            if (ch === '}') { depth -= 1; i += 1; continue; }
            if (ch === '>' && depth === 0) break;
            i += 1;
        }
        out.push(code.slice(match.index + match[0].length, i));
    }
    return out;
}

function countStyledControls(code, rule) {
    return openTagAttributes(code, rule.element).filter(
        (attributes) => /className\s*=/.test(attributes) && STYLING_SIGNAL.test(attributes),
    ).length;
}

/** `<input type="file">`, wherever the attribute sits in the tag. */
function countFileInputs(code) {
    return openTagAttributes(code, 'input').filter(
        (attributes) => /type\s*=\s*["']file["']/.test(attributes),
    ).length;
}

/**
 * The primitives that validate `label` and throw on anything but a non-empty
 * string. Kept beside the counter that reads them so the two cannot drift.
 */
const THROWS_ON_NON_STRING_LABEL = [
    'FormField', 'FieldDisplay', 'Checkbox', 'Radio', 'Switch',
    'IconButton', 'IconButtonLink', 'FileInput', 'ProgressBar',
];

/**
 * A JSX `label={...}` on a primitive that throws unless the label is a string.
 *
 * A counter rather than a regex for the same reason `countFileInputs` is one, and
 * the reason bit twice here: this rule used
 * `<(?:FormField|...)\b[^>]*?\blabel=\{` until a review on 2026-08-25, and
 * `[^>]*?` stops at the first `>` — including the one in `=>`. So
 *
 *     <FormField label={<span>Date</span>} onClick={() => go()}>   -> caught
 *     <FormField onClick={() => go()} label={<span>Date</span>}>   -> INVISIBLE
 *
 * and prop ordering alone decided whether a rule guarding a **runtime crash**
 * could see it. Measured before the fix: 1 violation against 0 for the same
 * element written the ordinary React way.
 */
function countJsxLabelsOnThrowingPrimitives(code) {
    let total = 0;
    for (const element of THROWS_ON_NON_STRING_LABEL) {
        total += openTagAttributes(code, element).filter(
            (attributes) => /\blabel\s*=\s*\{\s*[(<]/.test(attributes),
        ).length;
    }
    return total;
}

const COUNTERS = {
    'raw-file-input': countFileInputs,
    'jsx-label-on-throwing-primitive': countJsxLabelsOnThrowingPrimitives,
};

/**
 * @param {string} source
 * @param {string[] | null} [only] Restrict to these rule names; `null` = all.
 */
export function countViolations(source, only = null) {
    const isCss = Array.isArray(only) && only.every((name) => name.startsWith('css-'));
    const code = isCss ? stripBlockComments(source) : stripComments(source);
    const counts = {};
    const wanted = (name) => only === null || only.includes(name);

    // `only === null` means "every JSX rule". The CSS rules are opt-in by name,
    // because a hex in a `style={{}}` object is `raw-hex-colour`'s business and
    // running both would double-count it.
    for (const rule of (only === null ? RULES : [...RULES, ...CSS_RULES])) {
        if (!wanted(rule.name)) continue;
        const counter = COUNTERS[rule.name];
        if (counter) {
            const found = counter(code);
            if (found) counts[rule.name] = found;
            continue;
        }
        const subject = rule.prepare ? rule.prepare(code) : code;
        const found = subject.match(rule.pattern);
        if (found?.length) counts[rule.name] = found.length;
    }
    for (const rule of STYLED_CONTROL_RULES) {
        if (!wanted(rule.name)) continue;
        const found = countStyledControls(code, rule);
        if (found) counts[rule.name] = found;
    }
    return counts;
}

const REMEDIES = Object.fromEntries(
    [...RULES, ...CSS_RULES, ...STYLED_CONTROL_RULES].map((rule) => [rule.name, rule.remedy]),
);

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

function scan() {
    const measured = {};
    for (const file of sourceFiles(srcRoot())) {
        const relative = path.relative(srcRoot(), file).split(path.sep).join('/');
        const only = rulesFor(relative);
        if (Array.isArray(only) && only.length === 0) continue;
        const counts = countViolations(readFileSync(file, 'utf8'), only);
        if (Object.keys(counts).length > 0) measured[relative] = counts;
    }
    return measured;
}

function loadAllowlist() {
    try {
        return JSON.parse(readFileSync(allowlistPath(), 'utf8'));
    } catch {
        return { files: {} };
    }
}

/**
 * Does a `<table>` in this file certainly carry `ds-native-table`, on every path
 * it can render by?
 *
 * ## Why this one rule parses, when the rest of the file matches text
 *
 * Four review rounds. Round one matched the tag with `[^>]*` and truncated at the
 * `>` in `=>`. Round two matched the class with `includes()`, so
 * `ds-native-table-broken` counted. Round three searched the whole attribute
 * slice, so a `data-testid` counted. Round four found the one a string cannot
 * answer at all:
 *
 *     <table className={enabled ? 'ds-native-table' : 'other'}>
 *
 * The token IS in that text. The rendered table is off-contract half the time.
 * No amount of careful string matching decides that, because the question is not
 * "does this text appear" but "is this true on every branch" — and that is a
 * question about structure. So this rule asks the parser.
 *
 * The rest of the file still matches text, and roadmap section 7 records that as
 * the remaining debt with the reason it was not converted wholesale here: this
 * script gates every other check, and the allowlist's counts all have to come out
 * identical. This is the one rule where a bypass was proven four times.
 *
 * ## What counts as "certainly"
 *
 * Anything that cannot be shown to carry the token on every path is a violation,
 * including a bare identifier. That is deliberate: a guard that assumes the best
 * about `className={x}` is the guard that let all four bypasses through.
 */
function tablesOffContract(source, contractToken) {
    const ast = parse(source, {
        sourceType: 'module',
        plugins: ['jsx'],
        errorRecovery: false,
    });

    /* A token counts only as a whole class, delimited by whitespace or an edge. */
    const tokenIn = (text) => String(text).split(/\s+/).filter(Boolean).includes(contractToken);

    /*
     * The same, for one chunk of a template literal — where a token can be
     * extended by an interpolation sitting against it.
     *
     *     `ds-native-table ${density}`   token followed by a space: safe
     *     `ds-native-table${suffix}`     token runs into the hole: NOT safe
     *
     * Round five of this rule was exactly that: the quasi split to
     * ['ds-native-table'] and looked certain while one branch of the
     * interpolation rendered `ds-native-table-broken`. A token touching a quasi
     * edge only counts when that edge is the edge of the whole template rather
     * than an interpolation, so an open edge is padded with a non-space to make
     * the token un-whole.
     */
    const tokenInQuasi = (raw, openAtStart, openAtEnd) => tokenIn(
        `${openAtStart ? 'x' : ' '}${raw}${openAtEnd ? 'x' : ' '}`,
    );

    /*
     * True only when every path through `node` yields a class list containing a
     * token. Anything this cannot PROVE is a violation.
     *
     * ## Why the accepted set is deliberately small
     *
     * The first version of this walk also trusted `CallExpression`,
     * `ArrayExpression` and `+` concatenation, reasoning that their parts are all
     * joined. Round six showed that was my reasoning rather than JavaScript's:
     * `selectClass('ds-native-table', 'other')` is a call whose arguments are
     * NOT all joined, and nothing in the syntax says which kind of call it is.
     * Whitelisting known combiners would work, but this repository contains no
     * `clsx`, `classnames` or `cx`, and all fifteen real `<table>` classNames are
     * plain string literals — so each of those branches was accommodating a form
     * that does not exist, and each guess at its semantics became a false pass.
     *
     * They are gone. What remains is the set whose meaning is unambiguous, which
     * covers every real call site. A form outside it fails loudly, and extending
     * the set then means adding a branch WITH a test rather than an assumption.
     */
    const certainlyTokenised = (node) => {
        if (!node) return false;
        switch (node.type) {
            case 'StringLiteral':
                return tokenIn(node.value);
            case 'JSXExpressionContainer':
            case 'ParenthesizedExpression':
            case 'TSAsExpression':
            case 'TSNonNullExpression':
                return certainlyTokenised(node.expression);
            case 'TemplateLiteral':
                return node.quasis.some((quasi, index) => tokenInQuasi(
                    quasi.value.cooked ?? quasi.value.raw,
                    index > 0,
                    index < node.quasis.length - 1,
                ));
            case 'ConditionalExpression':
                return certainlyTokenised(node.consequent) && certainlyTokenised(node.alternate);
            case 'LogicalExpression':
                // `a || b` and `a ?? b` yield one side or the other, so both must
                // carry it. `a && b` yields a falsy `a` — no class at all — so it
                // can never be certain.
                if (node.operator === '&&') return false;
                return certainlyTokenised(node.left) && certainlyTokenised(node.right);
            default:
                // Identifier, member expression, any call, array, concatenation,
                // object form, anything else: not provable, therefore not allowed.
                return false;
        }
    };

    const offContract = [];
    let total = 0;
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node.type === 'JSXOpeningElement' && node.name?.type === 'JSXIdentifier'
            && node.name.name === 'table') {
            total += 1;
            /*
             * The LAST attribute that can set the class list is the one that
             * decides it. JSX applies attributes in order, so a later duplicate
             * or a later spread overrides an earlier `className` at runtime:
             *
             *     <table className="ds-native-table" {...props}>
             *     <table className="ds-native-table" className={other}>
             *
             * Taking the first match and ignoring what follows was the seventh
             * demonstrated bypass of this rule, reproduced in `AssignmentTable`.
             *
             * Unlike the expression space, this one is CLOSED: an opening
             * element's attributes are exactly `JSXAttribute | JSXSpreadAttribute`
             * and there is no third way to set a prop. So "find the last setter
             * and require it to be a provable class" is complete over the
             * grammar rather than another guess. A spread BEFORE the class is
             * fine — the class still wins — and this allows it.
             */
            let lastSetter = null;
            for (const attribute of node.attributes) {
                if (attribute.type === 'JSXSpreadAttribute') {
                    lastSetter = { spread: true };
                } else if (attribute.type === 'JSXAttribute'
                    && (attribute.name?.name === 'className' || attribute.name?.name === 'class')) {
                    lastSetter = { value: attribute.value };
                }
            }
            if (lastSetter?.spread || !certainlyTokenised(lastSetter?.value)) {
                offContract.push(node.loc?.start?.line ?? 0);
            }
        }
        for (const key of Object.keys(node)) {
            if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
            walk(node[key]);
        }
    };
    walk(ast.program);
    return { offContract, total };
}

function main() {
    const update = process.argv.includes('--update');
    const allowlist = loadAllowlist();
    const measured = scan();

    // A guard that cannot fail on a broken input is not a guard. If the walker
    // finds nothing at all, something is wrong with the walker.
    // Raised from 200 when stylesheets joined the walk on 2026-08-25.
    const scanned = sourceFiles(srcRoot()).length;
    if (scanned < 400) {
        console.error(`\nThe UI contract scan reached only ${scanned} files. That is a broken check, not a clean result.\n`);
        process.exit(1);
    }

    if (update) {
        const files = {};
        for (const [file, counts] of Object.entries(measured).sort()) {
            const previous = allowlist.files?.[file] ?? {};
            files[file] = { ...counts };
            // Annotations survive a regeneration; only the numbers are recomputed.
            // A `reasons` entry for a rule the file no longer breaks is dropped
            // with it, so a retired exception cannot linger as cover for a
            // future one.
            if (previous.reasons) {
                const live = Object.fromEntries(
                    Object.entries(previous.reasons).filter(([rule]) => rule in counts),
                );
                if (Object.keys(live).length > 0) files[file].reasons = live;
            }
            /*
             * `debt` used to be the other way to pass — "a migration slice still
             * owes work here". It is deliberately not carried forward: since
             * 2026-08-25 every entry needs a reason, and `--update` inventing one
             * would defeat the point. An entry whose rule has no reason fails the
             * check below instead, which is where the author has to write it.
             */
        }
        writeFileSync(allowlistPath(), `${JSON.stringify({
            $comment: allowlist.$comment,
            files,
        }, null, 2)}\n`);
        const total = Object.values(measured).reduce(
            (sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0), 0,
        );
        console.log(`Inventory updated: ${Object.keys(files).length} files, ${total} tolerated violations.`);
        return;
    }

    const problems = [];
    let toleratedTotal = 0;

    for (const [file, counts] of Object.entries(measured)) {
        const allowed = allowlist.files?.[file] ?? {};
        for (const [rule, count] of Object.entries(counts)) {
            const permitted = typeof allowed[rule] === 'number' ? allowed[rule] : 0;
            toleratedTotal += Math.min(count, permitted);
            if (count > permitted) {
                problems.push({
                    kind: 'new',
                    file,
                    rule,
                    detail: permitted === 0
                        ? `${count} new`
                        : `${count}, inventory allows ${permitted}`,
                });
            }
        }
    }

    /*
     * An approved native table must apply the native-table contract.
     *
     * The roadmap has always said both halves of this: a native `<table>` is
     * approved for an editable matrix or per-row interactive rows, AND "a native
     * table is not a licence to style a table by hand". Only the first half was
     * checked. Measured on 2026-08-25: seven of the eleven approved native tables
     * referenced no `--ds-table-*` role at all, and their inline cell padding had
     * drifted to three different values (24px, 20px, 16px) against a contract of
     * 20px. They looked right because `bg-ds-surface-subtle` happens to be what
     * the header role resolves to — a coincidence a re-tuned role would break in
     * silence.
     *
     * `ds-native-table` is that contract, so requiring the class is how the
     * second half of the permission becomes enforceable.
     *
     * ## Per table, not per file
     *
     * The first version of this asked whether the *file* mentioned
     * `ds-native-table` anywhere, which a file with three tables satisfies by
     * putting the class on one of them. `AnalyticsView.jsx` is exactly that
     * shape — three approved `<table>` elements — so the weaker check was one
     * edit away from passing a hand-styled table again, which is the finding
     * this rule was written for. It counts tables now.
     *
     * ## No carve-out for a hidden table, since round eight
     *
     * There used to be one: `AnalyticsView`'s `sr-only` chart-equivalent table was
     * exempt, on the reasoning that something invisible has no appearance to put
     * on contract. The reasoning was fine and the *inference* was not — deciding
     * "is this hidden?" from a class list means deciding it across Tailwind's
     * whole variant space, and `className="sr-only xl:not-sr-only"` is hidden on a
     * phone and visible on a desktop. That pattern is already in this repository
     * (`DossierHeader.jsx`), so it was not hypothetical.
     *
     * Rather than guard an open-ended axis, the axis is gone: **every** approved
     * `<table>` must carry the class, the hidden one included. Measured in a real
     * browser with the built stylesheet before doing it — `sr-only` keeps
     * `position:absolute` and `clip:rect(0,0,0,0)`, so the element stays invisible
     * whatever the contract does to its box (10x20 -> 47x39, `visible: false`
     * both ways). An invisible table carrying a visual contract costs nothing;
     * inferring invisibility from classes cost four rounds of review.
     *
     * ## And it parses, rather than matching text
     *
     * This rule went through four review rounds, each closing a bypass the
     * previous fix left: a `[^>]*` tag match truncating at the `>` in `=>`, an
     * `includes()` class match accepting `ds-native-table-broken`, a whole-slice
     * search accepting a `data-testid` that named the contract, and finally
     * `className={enabled ? 'ds-native-table' : 'other'}` — where the token IS in
     * the text and the rendered table is off-contract half the time.
     *
     * That last one is why it now asks `@babel/parser`. No amount of careful
     * string matching answers it, because the question is not "does this text
     * appear" but "is this true on every branch", which is a question about
     * structure. See `tablesOffContract`.
     */
    const untethered = [];
    for (const [file, allowed] of Object.entries(allowlist.files ?? {})) {
        if (typeof allowed['raw-table'] !== 'number') continue;
        // `DataTable` IS the display-table contract; it does not consume the
        // native one.
        if (file.startsWith('design-system/')) continue;
        const source = readFileSync(path.join(srcRoot(), file), 'utf8');
        let result;
        try {
            result = tablesOffContract(source, 'ds-native-table');
        } catch (error) {
            // A parse failure is a failure. Falling back to a text match here is
            // how the four bypasses this rule now parses for would come back.
            untethered.push(`${file} (could not be parsed: ${error.message})`);
            continue;
        }
        if (result.offContract.length > 0) {
            untethered.push(
                `${file} (${result.offContract.length} of ${result.total}, `
                + `line${result.offContract.length > 1 ? 's' : ''} ${result.offContract.join(', ')})`,
            );
        }
    }

    /*
     * Every allowlist entry must say why it is there.
     *
     * This is what makes the file an allowlist rather than a pile of tolerated
     * numbers. Without it, "add it to the allowlist" is a way to make any
     * failure go away, and the next reader has no way to tell a deliberate
     * exception from something someone was in a hurry about.
     */
    const unexplained = [];
    for (const [file, allowed] of Object.entries(allowlist.files ?? {})) {
        for (const rule of Object.keys(allowed)) {
            if (rule === 'reasons') continue;
            const reason = allowed.reasons?.[rule];
            if (typeof reason !== 'string' || reason.trim().length < 20) {
                unexplained.push(`${file} → ${rule}`);
            }
        }
    }

    // Shrinkage: the allowlist describes a tree that no longer exists.
    const stale = [];
    for (const [file, allowed] of Object.entries(allowlist.files ?? {})) {
        const counts = measured[file] ?? {};
        for (const [rule, permitted] of Object.entries(allowed)) {
            if (rule === 'reasons') continue;
            const count = counts[rule] ?? 0;
            if (count < permitted) stale.push(`${file} → ${rule}: ${permitted} → ${count}`);
        }
    }

    if (problems.length > 0) {
        console.error('\nUI contract violations that the allowlist does not cover:\n');
        const byRule = new Map();
        for (const problem of problems) {
            if (!byRule.has(problem.rule)) byRule.set(problem.rule, []);
            byRule.get(problem.rule).push(problem);
        }
        for (const [rule, entries] of byRule) {
            console.error(`  ${rule}`);
            console.error(`    ${REMEDIES[rule]}`);
            for (const entry of entries) console.error(`      ${entry.file}  (${entry.detail})`);
            console.error('');
        }
        console.error('If one of these is a genuine, documented exception, add it to');
        console.error('src/design-system/ui-contract.allowlist.json under `reasons`, keyed by rule,');
        console.error('naming the roadmap entry that justifies it. Do not add one without that —');
        console.error('an unexplained entry is how the inventory stops meaning anything.\n');
        process.exit(1);
    }

    if (unexplained.length > 0 && !update) {
        console.error('\nThese allowlist entries do not say why they are allowed:\n');
        for (const entry of unexplained) console.error(`  ${entry}`);
        console.error('\nEvery entry needs a `reasons` entry for its rule, naming the roadmap');
        console.error('item that justifies it. The `debt` escape hatch was removed once the');
        console.error('migration finished — an exception is now a decision, not a promise.\n');
        process.exit(1);
    }

    if (untethered.length > 0) {
        console.error('\nThese approved native tables do not apply the native-table contract:\n');
        for (const file of untethered) console.error(`  ${file}`);
        console.error('\nAdd `ds-native-table` to every `<table>` in the file. A native table is');
        console.error('approved for an editable matrix or per-row interactive rows — it is not a');
        console.error('licence to style a table by hand, and the class is what makes the header,');
        console.error('divider, density and cell padding come from the same `--ds-table-*` roles');
        console.error('`DataTable` reads. There is no exemption for a hidden table: deciding');
        console.error('whether a class list is hidden at every breakpoint is not decidable, so');
        console.error('the invisible one carries the class too. It costs nothing.\n');
        process.exit(1);
    }

    if (stale.length > 0) {
        console.error('\nThe UI contract allowlist is out of date — these have been fixed:\n');
        for (const line of stale) console.error(`  ${line}`);
        console.error('\nRun `npm run check:ui-contract -- --update` and commit the result, so the');
        console.error('inventory records the shrinkage rather than quietly permitting a regression');
        console.error('back up to the old number.\n');
        process.exit(1);
    }

    console.log(
        `UI contract intact: ${scanned} files scanned, ${toleratedTotal} known violations `
        + `across ${Object.keys(measured).length} files, none new.`,
    );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main();
}
