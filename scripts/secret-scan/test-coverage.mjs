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
    // `implementationFiles` returns native paths. Normalise before comparing
    // with the repository-style names below so the same guard is usable on
    // Windows rather than failing before it reaches the security assertions.
    const files = implementationFiles().map((file) => file.replaceAll('\\', '/')
        .replace(/^.*\/scripts\//, ''));
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
        // A builtin is importable bare or `node:`-prefixed, and matching only the
        // prefixed form let this through. Reported 2026-08-28; both are rows now
        // because two spellings is the entire set the resolver accepts.
        ['createRequire alias via bare "module"',
            "import { createRequire } from 'module';\nconst load = createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['createRequire alias with a comment before node:module',
            "import { createRequire } from /* hidden */ 'node:module';\n"
            + "const load = createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['dynamic node:module import with a comment before its parenthesis',
            "const { createRequire } = await import /* hidden */ ('node:module');\n"
            + "const load = createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['createRequire alias through a hex-escaped node:module',
            "import { createRequire } from 'node:\\x6dodule';\n"
            + "const load = createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        // `process.getBuiltinModule('module')` reaches the same loader without an
        // import declaration, so the graph probe cannot see it and the two
        // `node:module` spellings above do not cover it. Keep the API name
        // forbidden in every ordinary spelling; the scanner has no need for it.
        ['process.getBuiltinModule loader gateway',
            "const load = process.getBuiltinModule('module').createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['globalThis.process.getBuiltinModule loader gateway',
            "const load = globalThis.process.getBuiltinModule('module').createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['bracket-literal getBuiltinModule loader gateway',
            "const load = process['getBuiltinModule']('module').createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['destructured getBuiltinModule loader gateway',
            "const { getBuiltinModule } = process;\n"
            + "const load = getBuiltinModule('module').createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['unicode-escaped getBuiltinModule loader gateway',
            "const load = process.getBuiltin\\u004dodule('module').createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['computed-bracket getBuiltinModule loader gateway',
            "const load = process['getBuiltin' + 'Module']('module').createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['computed-destructuring getBuiltinModule loader gateway',
            "const { ['getBuiltin' + 'Module']: get } = process;\n"
            + "const load = get('module').createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['multi-fragment commented computed-destructuring loader gateway',
            "const { [\"get\" /* split */ + 'Builtin' + `Module`]: get } = process;\n"
            + "const load = get('module').createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['hex-escaped computed-destructuring loader gateway',
            "const { ['getBuiltin\\x4dodule']: get } = process;\n"
            + "const load = get('module').createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['non-literal key through an aliased process object',
            "const ambient = process;\nconst key = ['getBuiltin', 'Module'].join('');\n"
            + "const load = ambient[key]('module').createRequire(import.meta.url);\n"
            + "export function deferred() { return load('../else' + 'where.cjs'); }", false],
        ['constructor chain after an approved process member',
            "const build = process.env.constructor.constructor;\n"
            + "const source = \"return im\" + \"port('../else' + 'where.mjs')\";\n"
            + 'export function deferred() { return build(source)(); }', false],
        ['computed constructor chain after an approved process member',
            "const key = ['con', 'structor'].join(''); const build = process.env[key][key];\n"
            + "const source = \"return im\" + \"port('../else' + 'where.mjs')\";\n"
            + 'export function deferred() { return build(source)(); }', false],
        ['constructor chain after a parenthesized process expression',
            "const build = (process.cwd()).constructor.constructor;\n"
            + "const source = \"return im\" + \"port('../else' + 'where.mjs')\";\n"
            + 'export function deferred() { return build(source)(); }', false],
        ['computed chain after nested parenthesized process expression',
            "const key = ['con', 'structor'].join(''); const build = (((process.env.X)))[key][key];\n"
            + "const source = \"return im\" + \"port('../else' + 'where.mjs')\";\n"
            + 'export function deferred() { return build(source)(); }', false],
        ['the scanner\'s approved process members',
            'void process.arch; void process.argv[1]; process.cwd(); void process.env.X; '
            + 'if (false) process.exit(1); void process.platform;', true],
        ['eval reaching a loader', "eval(\"import('../elsewhere.mjs')\");", false],
        ['aliased eval reaching a loader',
            "const execute = eval; const source = \"im\" + \"port('../else' + 'where.mjs')\";\n"
            + 'execute(source);', false],
        ['Function reaching a loader without new',
            "const source = \"return im\" + \"port('../else' + 'where.mjs')\"; Function(source)();", false],
        ['new Function reaching a loader', "new Function(\"return import('../elsewhere.mjs')\")();", false],
        // An ESM specifier is a URL, so `?query` and `#frag` still name the file.
        // Resolving the raw text found nothing and SKIPPED it, which let an outside
        // module escape; these two are the escape, and must be refused.
        ["import('../elsewhere.mjs?scanner')", "await import('../elsewhere.mjs?scanner');", false],
        ["from '../elsewhere.mjs#frag'", "import { a } from '../elsewhere.mjs#frag';", false],
        // And the suffix must not break a legitimate inside-the-set import.
        ["import('./ok.mjs?scanner')", "await import('./ok.mjs?scanner');", true],
        // Reported 2026-08-28: being ONE LITERAL was the whole test, and a literal
        // need not be relative. Each of these three is a single literal, so each
        // passed; the containment scan reads only `./` and `../`, so none was
        // resolved; and a deferred call in a function body never reaches the
        // probe. Reproduced against all three — the outside module really loads.
        ["deferred import('file:///...')",
            "export function later() { return import('file:///tmp/elsewhere.mjs'); }", false],
        ["deferred import('/abs/path')",
            "export function later() { return import('/tmp/elsewhere.mjs'); }", false],
        ["deferred import('bare-package')",
            "export function later() { return import('some-package'); }", false],
        // The refusal is a class, not a list, so the two accountable kinds have to
        // stay legal or it would be a rule against the scanner's own source: a
        // builtin is not a file in this repository, and a relative specifier is
        // resolved and contained by the scan below.
        ["deferred import('node:fs')", "export function later() { return import('node:fs'); }", true],
        ["deferred import('fs')", "export function later() { return import('fs'); }", true],
        ["deferred import('./ok.mjs')", "export function later() { return import('./ok.mjs'); }", true],
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
     * Nothing excuses an unloaded module, and that is the fix rather than a
     * limitation.
     *
     * L33's first version let a covered file "name" a module to excuse it, so a
     * lazily imported one would not read as an orphan. Three review rounds found
     * three ways through that excuse: a path in a COMMENT, a COMMENTED-OUT
     * import, and two orphans importing each other — a flat set of named targets
     * is not reachability from a root. All three were the same mistake: deciding
     * lexically what Node already computes exactly.
     *
     * The scanner has no dynamic import at all (measured: zero across all five
     * covered files), so the excuse was machinery for a case that does not occur
     * here, and every bug in it was pure cost. These rows pin that all four ways
     * of mentioning a module — a real lazy import included — leave it an orphan,
     * because only being LOADED counts.
     */
    for (const [label, snippet, mutual] of [
        ['a comment mentioning the path', "// Documentation mentions './orphan.mjs'.", false],
        ['a commented-out import', "// Historical example: import './orphan.mjs';", false],
        ['a deferred import', "export async function s() { return import('./orphan.mjs'); }", false],
        ['another orphan importing it', '// nothing here references either orphan', true],
    ]) {
        const dir = mkdtempSync(joinPath(tmpdir(), 'safehaul-orphan-'));
        writeFileSync(joinPath(dir, 'orphan.mjs'),
            mutual ? "import './second.mjs';\nexport const v = 1;\n" : 'export const v = 1;\n');
        if (mutual) writeFileSync(joinPath(dir, 'second.mjs'), "import './orphan.mjs';\nexport const w = 1;\n");
        writeFileSync(joinPath(dir, 'entry.mjs'), `${snippet}\nexport const x = 1;\n`);
        const orphaned = unreachableCovered(joinPath(dir, 'entry.mjs'), dir)
            .some((f) => f.endsWith('orphan.mjs'));
        assert(`L34. ${label} does not make an unloaded module reachable`, orphaned,
            'only being loaded counts; anything lexical is a way for dead source to vouch for itself');
        rmSync(dir, { recursive: true, force: true });
    }

    /*
     * And the converse, so the check is a subtraction rather than a blanket
     * refusal: a module the entry really imports is not an orphan.
     */
    {
        const dir = mkdtempSync(joinPath(tmpdir(), 'safehaul-live-'));
        writeFileSync(joinPath(dir, 'used.mjs'), 'export const v = 1;\n');
        writeFileSync(joinPath(dir, 'entry.mjs'), "import './used.mjs';\nexport const x = 1;\n");
        assert('L34b. but a module the entry actually imports is not an orphan',
            unreachableCovered(joinPath(dir, 'entry.mjs'), dir).length === 0,
            'otherwise the check would refuse the scanner as it stands');
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
