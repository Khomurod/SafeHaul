/**
 * Where the guard looks, and what counts as a file it should read.
 *
 * ## Paths are resolved LAZILY, and that is load-bearing
 *
 * `countViolations` and `stripComments` are imported by
 * `src/tests/uiContract.ratchet.test.js` to prove this guard can fail, and Vitest
 * rewrites `import.meta.url` to a non-file URL. Computing paths at module scope
 * made the whole module throw on import, before a single rule could run — so
 * every path here is behind a function call and **must stay that way**. Do not
 * hoist any of these into a module-level `const`.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Resolved lazily, not at module scope. `countViolations` and `stripComments`
 * are imported by `src/tests/uiContract.ratchet.test.js` to prove this guard can
 * fail, and Vitest rewrites `import.meta.url` to a non-file URL — computing
 * paths on import made the whole module throw before a single rule could run.
 */
export function repoRoot() {
    // `../..` because this module lives in `scripts/ui-contract/`; it was `..`
    // when everything was one file in `scripts/`.
    return fileURLToPath(new URL('../..', import.meta.url));
}
export function srcRoot() {
    return path.join(repoRoot(), 'src');
}
export function allowlistPath() {
    return path.join(srcRoot(), 'design-system/ui-contract.allowlist.json');
}

/* ------------------------------------------------------------------ *
 * Source scanning
 * ------------------------------------------------------------------ */

export const isTestFile = (name) => /\.(test|spec)\.[jt]sx?$/.test(name);

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
export const TOKEN_DEFINITION_FILES = new Set([
    'design-system/tokens/foundation.css',
    'design-system/tokens/semantic.css',
]);

/**
 * What counts as a file this guard reads.
 *
 * A named export rather than a literal inside the walk, because it is the single
 * highest-leverage thing here and nothing could see it change: dropping `css`
 * takes the scan from 554 files to 528, which still clears the only floor there
 * was, and silently stops reading 26 stylesheets — the exact way
 * `src/shared/styles/designTokens.css` sat through the whole campaign with a
 * second colour, type, radius and shadow scale in forty-odd raw hexes.
 * `scripts/test-ui-contract-scope.mjs` §S1 and §S2 pin both halves: the pattern
 * itself, and that the live scan still reaches each format it claims to cover.
 */
export const SOURCE_FILE_PATTERN = /\.(?:[jt]sx?|css)$/;

export function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(target);
        if (!SOURCE_FILE_PATTERN.test(entry.name)) return [];
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
