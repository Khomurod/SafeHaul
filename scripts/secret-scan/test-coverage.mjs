#!/usr/bin/env node
/**
 * Is the source those pinning assertions read the source the scanner runs?
 *
 * Split out of `scripts/secret-scan/test-pinning.mjs` on 2026-08-28, when that
 * file crossed the 500-line maximum carrying both halves. The two are genuinely
 * different subjects, and the distinction is the one this whole PR kept
 * relearning: `test-pinning.mjs` asserts PROPERTIES of the scanner's source — the
 * version is pinned, `--all` never appears, `.gitleaks.toml` is unchanged — while
 * this file asserts that "the scanner's source" is the right set of bytes in the
 * first place. Every property above is worthless if this is wrong, because a
 * regex over the wrong file passes for the wrong reason.
 *
 * Both directions are checked. A closure that had silently collapsed to the entry
 * would make "`--all` never appears" true by reading almost nothing; an orphan
 * left in the directory would keep a pinned flag green after the entry stopped
 * executing it. L27-L34 are the seven review rounds that found each way in.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join as joinPath, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert } from './test-support.mjs';
import { implementationFiles, unreachableCovered, uncoveredLoads } from './test-sources.mjs';

const here = dirname(fileURLToPath(import.meta.url));

{
    /*
     * The assertions above are only as wide as what they read, and what they read
     * is now derived rather than written down. Both directions are checked here,
     * because a closure that had silently collapsed to the entry would make
     * "`--all` never appears" true by reading almost nothing — the exact shape of
     * failure the guard exists to prevent.
     *
     * In practice a collapse also fails L9, L10 and L25 outright, since the
     * digest, the two scan modes and `--ignore-gitleaks-allow` all live in
     * modules rather than in the entry. These two say so directly, so the reason
     * is in the output instead of being inferred from three unrelated failures.
     */
    const files = implementationFiles().map((file) => file.replace(/^.*\/scripts\//, ''));
    /*
     * Asserted against the DIRECTORY, not against a written list of five names.
     * Review on 2026-08-27 made the difference matter: a hard-coded list keeps
     * passing when a sixth module joins the scanner, so the one file a pinned flag
     * had just moved into could be the one nothing reads. Reading the directory
     * means a new module is covered the moment it exists.
     */
    const onDisk = readdirSync(resolvePath(here, '.'))
        .filter((name) => name.endsWith('.mjs') && !name.startsWith('test-'))
        .map((name) => `secret-scan/${name}`);
    assert('L27. the source these checks read is every module the scanner is made of',
        ['secret-scan.mjs', ...onDisk].every((f) => files.includes(f))
        && files.length === onDisk.length + 1,
        `closure ${files.join(', ')} vs directory ${onDisk.join(', ')}`);
    /*
     * The syntax that used to slip through, driven against a throwaway scanner.
     *
     * The first version followed the entry's imports with a regex that recognised
     * only single-quoted `from '...'` and `import('...')`. Review reproduced an
     * entry using four other forms and got a closure of two files out of five —
     * meaning a pinned flag could live in an omitted module while every assertion
     * above kept passing over source that no longer contained it.
     *
     * Collection is a directory listing now, so none of these forms can omit
     * anything; this proves it for each of them rather than trusting the argument.
     */
    const fixture = mkdtempSync(joinPath(tmpdir(), 'safehaul-closure-'));
    const forms = {
        'double-quoted.mjs': 'import { a } from "./double-quoted.mjs";',
        'side-effect.mjs': "import './side-effect.mjs';",
        'reexport.mjs': "export * from './reexport.mjs';",
        'dynamic-double.mjs': 'await import("./dynamic-double.mjs");',
        'backtick.mjs': 'await import(`./backtick.mjs`);',
        'multi-line.mjs': "import {\n  b,\n} from './multi-line.mjs';",
    };
    writeFileSync(joinPath(fixture, 'entry.mjs'), Object.values(forms).join('\n'));
    for (const name of Object.keys(forms)) writeFileSync(joinPath(fixture, name), 'export const a = 1;\n');
    const reached = implementationFiles(joinPath(fixture, 'entry.mjs'), fixture)
        .map((f) => f.slice(fixture.length + 1));
    assert('L29. no module-loading syntax can drop a file out of the covered set',
        Object.keys(forms).every((name) => reached.includes(name)),
        `missed ${Object.keys(forms).filter((n) => !reached.includes(n)).join(', ') || 'nothing'}`);

    /*
     * A specifier this cannot read is a refusal, not a skip.
     *
     * Review found the hole the directory listing did not close: containment is
     * decided by READING specifiers, and a concatenated one executes the real
     * module while the scan sees only the first fragment — which resolves to
     * nothing and was skipped as if it were a path in a comment. Reproduced: an
     * entry doing `import('../else' + 'where.mjs')` produced a closure of one
     * file, and Node loaded the escaped module perfectly happily.
     *
     * The fragment is not the thing to catch. A static import specifier is a
     * literal by the language's grammar, so the only unanalysable form is a
     * dynamic call with a computed argument — refused as a class rather than by
     * spelling. Each row was driven separately; the template-with-interpolation
     * case is why: it reads as one quoted string and passed the first version.
     */
    const specifierCases = [
        ["import('./ok.mjs')", "await import('./ok.mjs');", true],
        ['import("./ok.mjs")', 'await import("./ok.mjs");', true],
        ['import(`./ok.mjs`)', 'await import(`./ok.mjs`);', true],
        ["static from './ok.mjs'", "import { a } from './ok.mjs';", true],
        ['import(variable)', 'await import(specifier);', false],
        ['import(`./${name}.mjs`)', 'await import(`./${name}.mjs`);', false],
        ["require('./a' + b)", "require('./a' + b);", false],
        ["import('../else' + 'where.mjs')", "await import('../else' + 'where.mjs');", false],
        // Both reported on 2026-08-28, both reproduced loading the outside module.
        ['import /* c */ (computed)', "await import /* c */ ('../else' + 'where.mjs');", false],
        // ECMA-262 defines exactly four line terminators; `[^\n]` covered two of
        // them, and a comment ended by the other two consumed through the call.
        // Reported 2026-08-28 with U+2028; all four are rows so the class stays shut.
        ['import //<U+2028>(computed)', "await import //\u2028('../else' + 'where.mjs');", false],
        ['import //<U+2029>(computed)', "await import //\u2029('../else' + 'where.mjs');", false],
        ['import //<CR>(computed)', "await import //\r('../else' + 'where.mjs');", false],
        ['import //<LF>(computed)', "await import //\n('../else' + 'where.mjs');", false],
        // And the deferred case the probe structurally cannot see: a function body
        // does not resolve until it runs, so the scan is the only thing covering it.
        ['deferred computed in a function', "export async function load() {\n  return await import('../else' + 'where.mjs');\n}", false],
        // Reported 2026-08-28: an aliased loader's call site is not spelled import
        // or require, so it is the gateway that has to be refused, not the call.
        ['createRequire alias',
            "import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['eval reaching a loader', "eval(\"import('../elsewhere.mjs')\");", false],
        ['new Function reaching a loader', "new Function(\"return import('../elsewhere.mjs')\")();", false],
        // An ESM specifier is a URL, so `?query` and `#frag` still name the file.
        // Resolving the raw text found nothing and SKIPPED it, which let an outside
        // module escape; these two are the escape, and must be refused.
        ["import('../elsewhere.mjs?scanner')", "await import('../elsewhere.mjs?scanner');", false],
        ["from '../elsewhere.mjs#frag'", "import { a } from '../elsewhere.mjs#frag';", false],
        // And the suffix must not break a legitimate inside-the-set import.
        ["import('./ok.mjs?scanner')", "await import('./ok.mjs?scanner');", true],
    ];
    for (const [label, source, shouldPass] of specifierCases) {
        const dir = mkdtempSync(joinPath(tmpdir(), 'safehaul-spec-'));
        mkdirSync(joinPath(dir, 'covered'));
        writeFileSync(joinPath(dir, 'elsewhere.mjs'), 'export const y = 1;\n');
        writeFileSync(joinPath(dir, 'covered', 'ok.mjs'), 'export const a = 1;\n');
        writeFileSync(joinPath(dir, 'covered', 'e.mjs'), `${source}\n`);
        let accepted = true;
        try {
            implementationFiles(joinPath(dir, 'covered', 'e.mjs'), joinPath(dir, 'covered'));
        } catch {
            accepted = false;
        }
        assert(`L31. ${shouldPass ? 'reads' : 'refuses'} ${label}`,
            accepted === shouldPass,
            shouldPass
                ? 'a plain literal is verifiable and must not be refused'
                : 'a computed specifier names a module this cannot see, so it must not be skipped');
        rmSync(dir, { recursive: true, force: true });
    }

    /*
     * And the other direction: a module living outside the covered directory is a
     * refusal, not a silent omission. That is what keeps the listing honest — the
     * scanner cannot grow a limb that nothing reads.
     */
    const outside = mkdtempSync(joinPath(tmpdir(), 'safehaul-outside-'));
    mkdirSync(joinPath(outside, 'covered'));
    writeFileSync(joinPath(outside, 'elsewhere.mjs'), 'export const x = 1;\n');
    writeFileSync(joinPath(outside, 'covered', 'entry.mjs'), "import { x } from '../elsewhere.mjs';\n");
    let refused = false;
    try {
        implementationFiles(joinPath(outside, 'covered', 'entry.mjs'), joinPath(outside, 'covered'));
    } catch (error) {
        refused = /do not read/.test(error.message);
    }
    assert('L30. a scanner module outside the covered directory is refused, not skipped',
        refused, 'silently omitting it is how the pinning assertions would go quiet');
    rmSync(fixture, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });

    /*
     * And the static half asked of Node rather than inferred.
     *
     * Three rounds running, review found a specifier spelling a regex could not
     * read — a double quote, a concatenation, a comment before the parenthesis, a
     * `?query` suffix. Each fix was right and the next spelling was already
     * waiting, because a regex is an inference about the grammar and the grammar
     * is bigger. This asks Node's own resolver what it loads, so no spelling can
     * be wrong about it. The scan above still covers what a probe cannot see: a
     * dynamic import inside a function body does not resolve until it runs.
     */
    assert('L32. everything Node loads for the scanner is source these checks read',
        uncoveredLoads().length === 0,
        `${uncoveredLoads().join(', ')} is executed but not read`);

    /*
     * And the other direction, which review on 2026-08-28 found missing. L32 asks
     * "is everything loaded also read"; this asks "is everything read also
     * loaded". A refactor that stops importing a module but leaves the file in
     * place produces an orphan whose stale source keeps being concatenated, so a
     * pinned flag or scan mode the entry no longer executes would still satisfy
     * L9, L10, L19 and L25. Reproduced with exactly such a module: every check
     * stayed green. A module named by a literal specifier counts as reachable
     * even when it is imported lazily, because a function body never reaches the
     * graph.
     */
    /*
     * What excuses an unloaded module, driven case by case.
     *
     * Review on 2026-08-28 found L33's first version excusing an orphan because a
     * covered file merely MENTIONED its path in a comment. The cause was reusing
     * the permissive containment matcher for a question whose safety direction is
     * the opposite: over-matching there costs a redundant check, over-matching
     * here vouches for dead source. These three pin the distinction, because the
     * fix is only correct if the middle row still passes.
     */
    for (const [label, snippet, expectOrphan] of [
        ['a comment mentioning the path', "// Documentation mentions './orphan.mjs'.", true],
        ['a deferred import of it', "export async function s() { return import('./orphan.mjs'); }", false],
        ['a static import of it', "import './orphan.mjs';", false],
    ]) {
        const dir = mkdtempSync(joinPath(tmpdir(), 'safehaul-orphan-'));
        writeFileSync(joinPath(dir, 'orphan.mjs'), 'export const v = 1;\n');
        writeFileSync(joinPath(dir, 'entry.mjs'), `${snippet}\nexport const x = 1;\n`);
        const orphaned = unreachableCovered(joinPath(dir, 'entry.mjs'), dir)
            .some((f) => f.endsWith('orphan.mjs'));
        assert(`L34. ${expectOrphan ? 'does not excuse' : 'excuses'} an unloaded module for ${label}`,
            orphaned === expectOrphan,
            expectOrphan
                ? 'a path in a comment is not an import; excusing it lets dead source keep the checks green'
                : 'a real import makes the module reachable even when it never reaches the graph');
        rmSync(dir, { recursive: true, force: true });
    }

    assert('L33. and everything these checks read is source the scanner loads',
        unreachableCovered().length === 0,
        `${unreachableCovered().join(', ')} is read but never loaded — an orphan's flags would `
        + 'keep the pinning assertions green over source that no longer runs');

    assert('L28. and it stops at the implementation, so the tests\' own fixtures cannot skew it',
        !files.some((file) => /(^|\/)test-/.test(file)),
        `${files.join(', ')} — test-failsafe.mjs runs a scan with --all on purpose, to prove `
        + 'such a range is refused; sweeping it in would fail L19 on its own fixture');
}
