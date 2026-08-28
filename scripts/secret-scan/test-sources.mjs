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
 * loudly instead of dropping out of the closure.
 *
 * A specifier that resolves to nothing is skipped rather than refused, because
 * the scan is deliberately permissive and a path named in a comment resolves to
 * nothing. Review on 2026-08-27 showed what that costs on its own: an entry
 * containing a CONCATENATED specifier executes the real module while the scan
 * captures only the first fragment, which resolves to nothing and is skipped —
 * so the module escapes containment entirely. Reproduced, and Node really does
 * load it.
 *
 * The fragment is not the thing to catch; the concatenation is. A static import
 * specifier is a string literal by the language's own grammar, so the only way to
 * name a module unanalysably is a dynamic `import()` or a `require()` with an
 * argument that is not one literal. Those are refused outright — the scanner uses
 * neither today, so the rule costs nothing and closes the whole class rather than
 * the one spelling of it.
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
 * Every dynamic `import()` / `require()` call, with whatever it was handed.
 *
 * `[^)]*` stops at the first `)`, so a specifier containing one produces a
 * partial argument that fails the literal test below and is refused. That is the
 * direction to fail in.
 */
const MODULE_CALL = /\b(?:import|require)\s*\(([^)]*)\)/g;

/**
 * One quoted string and nothing else — the only argument that can be verified.
 *
 * The `${` clause is not decoration: a template literal reads as a single quoted
 * string to the pattern above, so `` import(`./${name}.mjs`) `` passed it while
 * being every bit as computed as a concatenation. Caught by driving the forms one
 * at a time rather than reasoning about the regex.
 */
const SINGLE_LITERAL = /^\s*(['"`])(?:(?!\1)[^\\])*\1\s*$/;
const INTERPOLATED = /\$\{/;

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
        for (const [, argument] of source.matchAll(MODULE_CALL)) {
            if (SINGLE_LITERAL.test(argument) && !INTERPOLATED.test(argument)) continue;
            throw new Error(
                `${file.replace(/^.*\/scripts\//, 'scripts/')} loads a module with a computed `
                + `specifier: import(${argument.trim()}). Containment is decided by reading `
                + 'specifiers, and a concatenated or variable one names a file this cannot see — '
                + 'the fragment it does see resolves to nothing and would be skipped, so the real '
                + 'module escapes and the \u00a7L assertions read source that no longer contains '
                + 'what they check. Use one string literal.',
            );
        }
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
