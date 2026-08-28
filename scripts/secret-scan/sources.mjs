/**
 * Every file the scanner is actually made of, found by following its imports.
 *
 * ## Why this is a function and not a path
 *
 * The assertions that pin this gate's security properties are regexes over its
 * source: the version is an exact release and not `latest`, `--redact` and
 * `--ignore-gitleaks-allow` are passed, `--all` never is, a push never anchors at
 * its own `before`. Until 2026-08-27 the whole scanner was one file, so those
 * regexes read that file and the coverage was exact by accident.
 *
 * Splitting it into modules breaks that quietly and in the worst direction: a
 * regex over the entry point alone would keep passing while the flag it looks for
 * had been moved into a module — or deleted from one. So "the scanner's source"
 * is defined here instead, as the transitive closure of the entry's own relative
 * imports. A property cannot be relocated out from under the check, because
 * anything the gate runs is reachable from the entry by definition, and anything
 * unreachable is not the gate.
 *
 * Test files are not in the closure, and that is not an exclusion: the entry does
 * not import them. It matters, because they deliberately contain the shapes the
 * assertions forbid — `scripts/secret-scan/test-failsafe.mjs` runs a scan with
 * `--all` precisely to prove such a range is refused — and a concatenation that
 * swept them in would fail on its own fixtures.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The CLI the `secret-scan` job runs, which is the root of the closure. */
export const ENTRY = resolve(here, '../secret-scan.mjs');

/**
 * The entry and everything it imports, transitively, in a stable order.
 *
 * Only relative specifiers are followed: `node:*` and any dependency are not
 * this repository's to pin here.
 */
export function implementationFiles(entry = ENTRY) {
    const seen = new Set();
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.shift();
        if (seen.has(file)) continue;
        seen.add(file);
        const source = readFileSync(file, 'utf8');
        for (const [, specifier] of source.matchAll(/^\s*(?:import|export)[^'"]*from\s*'(\.[^']*)'/gm)) {
            queue.push(resolve(dirname(file), specifier));
        }
        // `await import('./x.mjs')` is a real edge too, and the entry point of a
        // split test suite is written that way.
        for (const [, specifier] of source.matchAll(/\bimport\(\s*'(\.[^']*)'\s*\)/g)) {
            queue.push(resolve(dirname(file), specifier));
        }
    }
    return [...seen].sort();
}

/** Those files' contents, concatenated, for the assertions that read the source. */
export function implementationSource(entry = ENTRY) {
    return implementationFiles(entry).map((file) => readFileSync(file, 'utf8')).join('\n');
}
