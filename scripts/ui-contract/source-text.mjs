/**
 * Which rules apply to a file, and how its source is reduced before they run.
 *
 * Comment stripping is the half that decides what a "violation" even is: a rule
 * firing on a line that documents the rule would be noise, and noise is what
 * gets a check switched off.
 */

import { TOKEN_DEFINITION_FILES } from './paths.mjs';
import { CSS_RULE_NAMES, JSX_RULE_NAMES } from './rules.mjs';

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
export const STORY_RULE_NAMES = [
    'raw-palette-class',
    'raw-black-white-class',
    'raw-hex-colour',
    'sub-12px-type',
    'off-scale-type',
    'arbitrary-type-size',
    'tailwind-radius',
    'tailwind-shadow',
    'hand-styled-button',
    'hand-styled-field',
    'hand-styled-anchor',
    // A story that writes its own stacking number is teaching one, and the
    // catalog is the last place a `z-[9999]` should be able to start.
    'raw-z-index',
    // Same argument, one shape over: a story hand-rolling a pressed control is
    // publishing the thing `Chip` and `SegmentedControl` exist to replace.
    'hand-rolled-toggle',
    'hand-rolled-current',
];

/**
 * The rules an HTML document is held to.
 *
 * The class-list rules only. `index.html` is a shell — it has no components to
 * hand-build, no tables and no form controls — but every class on it IS
 * compiled by Tailwind into the application's stylesheet, so a raw palette
 * class there ships exactly like one in a component. That is how
 * `<body class="bg-gray-50">` survived the whole campaign: the guard walked
 * `src/`, and Tailwind's `content` array does not.
 */
export const HTML_RULE_NAMES = [
    'raw-palette-class',
    'raw-black-white-class',
    'bare-tailwind-radius',
    'bare-tailwind-shadow',
    'raw-hex-colour',
    'sub-12px-type',
    'off-scale-type',
    'arbitrary-type-size',
    'tailwind-radius',
    'tailwind-shadow',
];

/**
 * The design system's own source, and the rules it is exempt from.
 *
 * Two, and both are the shape of exemption to be suspicious of: a rule that says
 * "use the primitive" cannot also fire on the primitive. `SegmentedControl` IS
 * the `role="group"` of `<button aria-pressed>` that `hand-rolled-toggle` points
 * people at (and `Chip` is the other one); `SectionNavigation` IS the
 * `<button aria-current>` rail that `hand-rolled-current` points at. Anywhere
 * else, an exemption this broad would be a hole — so it is a NAMED LIST rather
 * than a path skip: every other rule still applies inside `src/design-system/`,
 * and adding a third name here is a decision somebody has to write down.
 *
 * Catalog stories are not covered by this: they are routed to
 * `STORY_RULE_NAMES` first, which holds them to the rule deliberately.
 */
export const CONTRACT_ROOT = 'src/design-system/';
export const CONTRACT_EXEMPT_RULES = ['hand-rolled-toggle', 'hand-rolled-current'];

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
    if (relativePath.endsWith('.html')) return HTML_RULE_NAMES;
    if (relativePath.endsWith('.css')) {
        if (TOKEN_DEFINITION_FILES.has(relativePath)) return [];
        return CSS_RULE_NAMES;
    }
    if (/\.stories\.[jt]sx?$/.test(relativePath)) return STORY_RULE_NAMES;
    if (relativePath.startsWith(CONTRACT_ROOT)) {
        return JSX_RULE_NAMES.filter((name) => !CONTRACT_EXEMPT_RULES.includes(name));
    }
    return null; // null = every JSX rule
}

/**
 * Strips `<!-- … -->` while keeping everything else.
 *
 * For HTML, where the JavaScript comment forms mean nothing and `//` appears
 * inside every absolute URL — the same reason `stripBlockComments` exists for
 * CSS. Newlines are preserved so offsets stay usable.
 */
export function stripHtmlComments(source) {
    return source.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ''));
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
