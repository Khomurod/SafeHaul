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

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join as joinPath, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { removeTree } from '../lib/throwaway.mjs';

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
/*
 * Whitespace or a comment, between the keyword and its parenthesis.
 *
 * The line-comment branch ends at a LINE TERMINATOR, and ECMA-262 defines
 * exactly four: LF, CR, LS (U+2028) and PS (U+2029). Writing it as `[^\n]` was
 * wrong for the last two, and review on 2026-08-28 reproduced the consequence —
 * `import //\u2028('../else' + 'where.mjs')` let the branch consume through the
 * call, so a deferred computed import escaped the scan while a probe could not
 * see it either, because the function is never called.
 *
 * The set is closed by the specification, so this is the whole class rather than
 * one more spelling; the trailing terminator is optional because a comment may
 * end the file.
 */
const BETWEEN = '(?:\\s|/\\*[\\s\\S]*?\\*/|//[^\\n\\r\\u2028\\u2029]*)*';
const MODULE_CALL = new RegExp(`\\b(?:import|require)${BETWEEN}\\(([^)]*)\\)`, 'g');

/**
 * Gateways to a module loader that is not spelled `import` or `require`.
 *
 * Reported 2026-08-28 and reproduced: `const load = createRequire(import.meta.url)`
 * followed by `load('../else' + 'where.cjs')` escapes both halves. The call site
 * is `load(...)`, so `MODULE_CALL` never sees it, and a deferred call never
 * reaches the probe. Following the alias would need data-flow analysis, which a
 * parser alone does not give.
 *
 * Refusing the GATEWAY needs none of that: an indirect loader cannot be obtained
 * without naming where it comes from. `module` is where `createRequire` lives,
 * and it can be named three ways — imported, required, or fetched with
 * `process.getBuiltinModule`, which review found on 2026-08-28 because importing
 * is not the only way to hold a builtin. `eval` and `Function` are the routes
 * from a string to code. The covered files use none of them, so this costs
 * nothing and the scanner keeps loading modules the one way the checks above can
 * read.
 *
 * Each entry matches the thing being named rather than the expression naming it,
 * which is why `getBuiltinModule` is matched as a method and not as
 * `process.getBuiltinModule`: `const p = globalThis.process` in front of it is
 * the same route, and was reproduced alongside the reported one.
 *
 * It is not a proof, and AGENTS.md records why rather than implying otherwise: a
 * determined author with commit access can still reach a loader, and no static
 * check living in the same repository defeats an author who can also edit the
 * check. What this closes is the accidental and the disguised-but-legible.
 */
const LOADER_GATEWAY = new RegExp([
    // Both spellings. A Node builtin is importable bare or `node:`-prefixed, and
    // matching only the prefixed form let `from 'module'` through — reported and
    // reproduced on 2026-08-28, loading an outside CJS module through the alias.
    // Two spellings is the whole set the resolver accepts, so this closes it.
    // `module` hands out `createRequire`; `vm` evaluates a string in this realm,
    // and a string is where `process.getBuiltinModule('module')` can be written.
    // Measured: `vm.runInThisContext` cannot import on its own — it wants a
    // dynamic-import callback — but it reaches the loader through that string in
    // one step. Both are BUILTINS, so naming them is the only way to hold them,
    // and both specifier spellings are refused exactly as for `module`.
    String.raw`from\s*['"\x60](?:node:)?(?:module|vm)['"\x60]`,
    String.raw`(?:import|require)\s*\(\s*['"\x60](?:node:)?(?:module|vm)['"\x60]`,
    // Importing it is not the only way to hold it. `process.getBuiltinModule`
    // returns a builtin without any specifier the checks above can read, so
    // `process.getBuiltinModule('module').createRequire(import.meta.url)` reached
    // the same alias while the scan accepted the file and the graph showed only
    // the entry. Reported and reproduced on 2026-08-28.
    //
    // Matched as a bare IDENTIFIER, which took three rounds to get right. Anchoring
    // on `process.` missed `const p = globalThis.process; p.getBuiltinModule(…)`;
    // anchoring on the dot missed `const { getBuiltinModule } = process`, reported
    // and reproduced, and `const { getBuiltinModule: g } = process`, which came out
    // of the same probe. The property name survives every one of those, including
    // the rename — it is what the destructure has to spell — so the name is what
    // this matches. The bracketed form is the one spelling with no identifier in
    // it, so it keeps its own pattern.
    String.raw`\bgetBuiltinModule\b`,
    String.raw`\[\s*['"\x60]getBuiltinModule['"\x60]\s*\]`,
    // The legacy internals door. It does not currently hand out `module` — asked
    // twice, dotted and destructured, and it throws both ways — but it is the same
    // kind of thing and costs nothing to shut. Matched as a CALL rather than as a
    // bare name: `binding` is an ordinary English word, and refusing it everywhere
    // would fail a covered file for a sentence rather than for a gateway.
    String.raw`\bbinding\s*\(`,
    // Without `new` too: `Function("...")()` calls the same constructor. It was
    // refused only incidentally, by the containment check happening to resolve a
    // relative path inside the string, which is luck rather than a rule.
    String.raw`\bFunction\s*\(`,
    String.raw`\beval\s*\(`,
].join('|'));

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
 * A literal specifier this can actually account for.
 *
 * Being one string literal was the whole test until review on 2026-08-28 pointed
 * out that a literal need not be RELATIVE. `import('file:///tmp/x.mjs')`,
 * `import('/tmp/x.mjs')` and `import('some-package')` are each a single literal,
 * so each passed; `RELATIVE_SPECIFIER` then never looked at them, because it only
 * matches `./` and `../`; and a deferred call inside a function body never
 * reaches the probe. Reproduced against all three — the outside module really
 * loads, carrying whatever pinned behaviour was moved into it.
 *
 * The answer is not another form to refuse but the shape of the question. Two
 * kinds of specifier can be accounted for: a Node builtin, which is not a file in
 * this repository and so cannot hold scanner source, and a relative one, which
 * the containment scan below resolves and checks. Everything else — absolute
 * paths, every URL scheme, bare packages, `#` import-map entries — is refused as
 * one class rather than enumerated one round at a time.
 *
 * `builtinModules` is asked of Node rather than transcribed, so the list cannot
 * drift; the `node:` prefix is accepted on its own because it can only ever name
 * a builtin. This costs the scanner nothing: it loads `node:*` and `./*.mjs` and
 * has no dynamic import at all.
 *
 * Static `import ... from` is deliberately not subject to this. It resolves when
 * the module loads, so the probe sees it and L32 already covers it; this rule
 * exists for the deferred call the probe structurally cannot see.
 */
const isAccountableSpecifier = (specifier) => specifier.startsWith('node:')
    || builtinModules.includes(specifier)
    || /^\.\.?\//.test(specifier);

/**
 * What Node ACTUALLY loads, asked of Node.
 *
 * Three review rounds in a row found another specifier spelling that a regex
 * could not read: a double-quoted import, a concatenation, a comment between
 * `import` and its parenthesis, a `?query` suffix. Each fix was correct and each
 * time the next spelling was waiting, because a regex is an inference about the
 * grammar and the grammar is larger than the inference.
 *
 * So the static half of the question is no longer inferred. A child process
 * imports the entry with a resolution hook registered, and reports every file
 * Node resolves — `next()` IS Node's resolver, so every form the language allows
 * is handled by definition rather than by enumeration. Importing the entry is
 * side-effect free: it guards its own CLI behind `process.argv[1]`, and the suite
 * already imports these modules for their constants.
 *
 * This does not replace the specifier scan, and the reason is worth stating: a
 * dynamic `import()` inside a function body does not resolve until that function
 * runs, so the graph shows what loading the entry loads, not what it might load
 * later. The scan still refuses computed specifiers for exactly that gap.
 *
 * A probe that cannot run is a refusal, not a skip. "Could not ask" has been the
 * wrong answer to every question in this repository.
 *
 * It is exported separately rather than folded into `implementationFiles` because
 * importing a module RUNS it, and the fixtures that prove the specifier scan
 * refuses a computed import are deliberately broken — `import(variable)` throws.
 * A probe over those would report "could not run" for the fixture's own reason and
 * say nothing about the scanner. So the scan is what fixtures exercise, and the
 * probe is asked once, of the real thing.
 */
export function loadedGraph(entry = ENTRY) {
    const hooks = pathToFileURL(resolve(here, 'test-probe-hooks.mjs')).href;
    const record = joinPath(mkdtempSync(joinPath(tmpdir(), 'safehaul-probe-')), 'graph.txt');
    writeFileSync(record, '');
    try {
        // The record's path travels by `register`'s own `data` channel, which
        // hands it to the hooks' `initialize` before anything resolves. It was an
        // environment variable until the functions inventory guard refused it,
        // rightly: every environment variable this repository reads is inventoried
        // as SafeHaul configuration, and a temp file a harness hands its own child
        // process is not.
        //
        // Percent-encoded because this is a URL and the paths are interpolated
        // into it: a `#` anywhere in TMPDIR would otherwise truncate the script
        // at a fragment, and the probe would fail for a reason nothing explains.
        const bootstrap = 'import { register } from \'node:module\'; '
            + `register(${JSON.stringify(hooks)}, { data: ${JSON.stringify(record)} });`;
        const probed = spawnSync(process.execPath, [
            '--import',
            `data:text/javascript,${encodeURIComponent(bootstrap)}`,
            '--input-type=module',
            '-e', `await import(${JSON.stringify(pathToFileURL(entry).href)});`,
        ], { encoding: 'utf8' });
        if (probed.status !== 0) {
            throw new Error(
                'the module-graph probe could not run, so what the scanner loads is unknown: '
                + `${(probed.stderr || probed.error?.message || '').trim().split('\n').slice(-3).join(' ')}`,
            );
        }
        return readFileSync(record, 'utf8').split('\n').filter(Boolean)
            .map((url) => fileURLToPath(url.replace(/[?#].*$/, '')));
    } finally {
        removeTree(dirname(record));
    }
}

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
        const gateway = source.match(LOADER_GATEWAY);
        if (gateway) {
            throw new Error(
                `${file.replace(/^.*\/scripts\//, 'scripts/')} reaches a module loader through `
                + `${gateway[0].trim()}. An aliased loader's call site is not spelled import or `
                + 'require, so neither the specifier scan nor the graph probe can see what it '
                + 'loads. The scanner has no need for one; if it grows one, these assertions have '
                + 'to be taught to follow it first.',
            );
        }
        for (const [, argument] of source.matchAll(MODULE_CALL)) {
            const where = file.replace(/^.*\/scripts\//, 'scripts/');
            if (!SINGLE_LITERAL.test(argument) || INTERPOLATED.test(argument)) {
                throw new Error(
                    `${where} loads a module with a computed `
                    + `specifier: import(${argument.trim()}). Containment is decided by reading `
                    + 'specifiers, and a concatenated or variable one names a file this cannot see — '
                    + 'the fragment it does see resolves to nothing and would be skipped, so the real '
                    + 'module escapes and the \u00a7L assertions read source that no longer contains '
                    + 'what they check. Use one string literal.',
                );
            }
            const specifier = argument.trim().slice(1, -1);
            if (isAccountableSpecifier(specifier)) continue;
            throw new Error(
                `${where} loads a module with a specifier that is neither a Node builtin nor `
                + `relative: import('${specifier}'). A literal is not enough on its own — an `
                + 'absolute path, a URL or a bare package name is one literal, is never resolved '
                + 'by the containment scan, and inside a function body is never reached by the '
                + 'graph probe either, so the module it names escapes both halves of this check. '
                + 'Load scanner source with a relative specifier so containment can read it.',
            );
        }
        for (const [, specifier] of source.matchAll(RELATIVE_SPECIFIER)) {
            // `./x.mjs?scanner` and `./x.mjs#frag` load ./x.mjs — ESM specifiers are
            // URLs. Resolving the raw text found no file and skipped it, which is
            // how a module escaped containment with a query suffix. Measured.
            const target = resolve(dirname(file), specifier.replace(/[?#].*$/, ''));
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

/**
 * Covered modules the scanner does not actually use.
 *
 * The other direction, and review on 2026-08-28 was right that it was missing.
 * `uncoveredLoads` asks "is everything loaded also read"; this asks "is
 * everything read also loaded". A refactor that stops importing a module but
 * leaves the file in place produces an orphan whose stale source keeps being
 * concatenated into `implementationSource()` — so L9, L10, L19 and L25 could stay
 * green on a pinned flag or scan mode that the entry no longer executes.
 *
 * ## Why this is a subtraction and nothing more
 *
 * The first version excused a module that some covered file "named", so that a
 * lazily imported one would not read as an orphan. That excuse produced three
 * separate vulnerabilities in three review rounds: a path in a COMMENT excused an
 * orphan; a COMMENTED-OUT import excused one; and two orphans importing each
 * other excused each other, because a flat set of named targets is not
 * reachability from a root.
 *
 * All three came from the same mistake — deciding reachability lexically when
 * Node already computes it exactly. The scanner has no dynamic import at all
 * (measured: zero `import(` or `require(` across all five covered files), so the
 * excuse was machinery for a case that does not occur, and every bug it had was
 * therefore pure cost.
 *
 * So there is no excuse now: a covered module Node does not load is an orphan.
 * If the scanner ever needs a lazy import, this fails loudly and the check has to
 * be taught — which is the safe direction, and the one a contributor can see.
 */
export function unreachableCovered(entry = ENTRY, directory = here) {
    const loaded = new Set(loadedGraph(entry));
    return implementationFiles(entry, directory)
        .filter((file) => file !== entry && !loaded.has(file));
}

/**
 * Anything Node loads for the real scanner that the assertions would not read.
 *
 * Empty is the only acceptable answer. A non-empty list means the scanner has a
 * limb outside `scripts/secret-scan/`, so the §L regexes are reading less than
 * what runs.
 */
export function uncoveredLoads(entry = ENTRY, directory = here) {
    const covered = new Set(implementationFiles(entry, directory));
    return loadedGraph(entry).filter((file) => !covered.has(file));
}
