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

import { readdirSync, statSync } from 'node:fs';
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
    'src/design-system/tokens/foundation.css',
    'src/design-system/tokens/semantic.css',
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
export const SOURCE_FILE_PATTERN = /\.(?:[jt]sx?|css|html)$/;

/**
 * Everything the guard walks.
 *
 * `src/` plus the repository-root `index.html`, and the second one is the point:
 * Tailwind compiles `index.html` (`tailwind.config.js` lists it first in
 * `content`), so a utility class written there ships in the application's
 * stylesheet exactly like one written in a component — but the guard walked only
 * `src/`, so `<body class="bg-gray-50">` sat there unseen for the whole
 * campaign. **A check must not take its scope from a directory when the thing it
 * is checking is defined by a build config.** `test-ui-contract-scope.mjs` §S2f
 * asserts every static prefix in that `content` array is covered here.
 */
export function scanTargets() {
    return [srcRoot(), path.join(repoRoot(), 'index.html')];
}

/**
 * The files under a target, which may itself be a file.
 *
 * `scanTargets()` returns a directory and a file, and a walker that assumed
 * directories would simply have thrown on the second — so the single-file case
 * is handled here rather than at every call site.
 */
export function sourceFiles(target) {
    if (!statSync(target).isDirectory()) {
        return SOURCE_FILE_PATTERN.test(path.basename(target)) ? [target] : [];
    }
    return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
        const child = path.join(target, entry.name);
        if (entry.isDirectory()) return sourceFiles(child);
        if (!SOURCE_FILE_PATTERN.test(entry.name)) return [];
        // Tests assert on the very strings these rules forbid.
        if (isTestFile(entry.name)) return [];
        return [child];
    });
}
