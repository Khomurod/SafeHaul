/**
 * Walking the tree, and reading the allowlist it is checked against.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { allowlistPath, sourceFiles, srcRoot } from './paths.mjs';
import { rulesFor } from './source-text.mjs';
import { countViolations } from './counting.mjs';

export function scan() {
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

export function loadAllowlist() {
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
