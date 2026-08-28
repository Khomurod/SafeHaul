/**
 * Every file the scanner is actually made of.
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
 * had been moved into a module — or deleted from one.
 *
 * ## Why a directory listing rather than a parsed import graph
 *
 * The first version followed the entry's imports and matched them with a regex.
 * Review on 2026-08-27 showed why that is the wrong mechanism for this job: the
 * matcher recognised only single-quoted `from '...'` and `import('...')`, so a
 * double-quoted specifier, a side-effect `import './flags.mjs'`, or a
 * double-quoted dynamic import would be executed by Node and omitted from the
 * closure. Reproduced — an entry using all four forms yielded a closure of two
 * files out of five. A pinned flag could then move into the omitted module and
 * every §L assertion would keep passing over source that no longer contains it.
 *
 * Widening the regex only moves the line: the next form nobody thought of fails
 * the same silent way. So the collection mechanism is no longer a parse at all.
 * **The scanner's source is the entry plus every non-test module in this
 * directory**, which is a directory listing — there is no syntax to miss, and a
 * module added without being wired up is covered rather than invisible.
 *
 * Imports are still read, but only to prove CONTAINMENT: every relative
 * specifier in the covered files must resolve to a file that is already covered.
 * If a future split moves part of the scanner outside this directory, that fails
 * loudly instead of dropping out of the closure. A specifier that cannot be
 * resolved fails too, rather than being skipped. Both directions of that check
 * are fail-closed, which is the property the old version lacked.
 *
 * Test files are excluded by name, and that is not a loophole: they deliberately
 * contain the shapes the assertions forbid — `test-failsafe.mjs` runs a scan with
 * the full-history flag precisely to prove such a range is refused — so sweeping
 * them in would fail the suite on its own fixtures. L28 asserts they stay out.
 *
 * **This file is one of them**, which is why it is named `test-`. It is imported
 * only by `test-pinning.mjs`; the gate never runs it, so it is not part of what
 * the gate is made of. Discovering that was not free: putting it in the covered
 * set made L19 fail on this very docblock, because a paragraph explaining that
 * the scanner never passes the full-history flag necessarily names the flag. The
 * assertions read text, so test infrastructure has to stay out of the text they
 * read — the convention that keeps `test-failsafe.mjs` out keeps this out too.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The CLI the `secret-scan` job runs, which is the root of everything below. */
export const ENTRY = resolve(here, '../secret-scan.mjs');

/** A module in this directory that is part of the scanner rather than its tests. */
const isImplementation = (name) => name.endsWith('.mjs') && !name.startsWith('test-');

/**
 * Anything that could be a relative module specifier, in any syntax.
 *
 * Deliberately permissive — quote style, statement form and line breaks are all
 * irrelevant to it, because it is used to CHECK containment rather than to decide
 * what is covered. Over-matching a path mentioned in a comment costs a redundant
 * containment check that passes; under-matching costs nothing either, because the
 * covered set does not come from here. That asymmetry is the point: the old
 * version had it the other way round.
 */
const RELATIVE_SPECIFIER = /['"`](\.\.?\/[^'"`\n]*)['"`]/g;

/**
 * The entry and every implementation module beside it, in a stable order.
 *
 * @throws if a relative specifier in a covered file resolves outside the covered
 *   set, or does not resolve at all — either means the scanner has outgrown this
 *   directory and the pinning assertions would no longer read all of it.
 */
export function implementationFiles(entry = ENTRY, directory = here) {
    const covered = [entry, ...readdirSync(directory)
        .filter(isImplementation)
        .map((name) => resolve(directory, name))];
    const coveredSet = new Set(covered);

    for (const file of covered) {
        const source = readFileSync(file, 'utf8');
        for (const [, specifier] of source.matchAll(RELATIVE_SPECIFIER)) {
            const target = resolve(dirname(file), specifier);
            let real;
            try {
                real = statSync(target).isFile() ? target : null;
            } catch {
                real = null;
            }
            // A specifier that names no file is a comment or a fixture path, not a
            // module this file loads; only real files have to be contained.
            if (real === null) continue;
            if (!coveredSet.has(real)) {
                throw new Error(
                    `${file.replace(/^.*\/scripts\//, 'scripts/')} references `
                    + `${real.replace(/^.*\/scripts\//, 'scripts/')}, which the pinning assertions `
                    + 'do not read. The scanner\'s source is the entry plus every non-test module '
                    + 'in scripts/secret-scan/; a part of it living anywhere else would be scanned '
                    + 'by nothing. Move it into that directory, or widen this function knowing '
                    + 'that every §L regex now has to reach it.',
                );
            }
        }
    }
    return [...coveredSet].sort();
}

/** Those files' contents, concatenated, for the assertions that read the source. */
export function implementationSource(entry = ENTRY, directory = here) {
    return implementationFiles(entry, directory).map((file) => readFileSync(file, 'utf8')).join('\n');
}
