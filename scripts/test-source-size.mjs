#!/usr/bin/env node
/**
 * Tests for the source-size guard.
 *
 * A size checker fails in one particular way, and it is silent: a glob stops
 * matching, the report gets shorter, and a shorter report reads as progress. So
 * the point of this file is less "does it count correctly" than **can it stop
 * looking without anyone noticing** — every section below exists to make one
 * way of going blind impossible.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXCLUDED,
  HARD_LIMIT,
  ACCOUNTED_FORMATS,
  NOT_SOURCE_FORMATS,
  REQUIRED_ROOTS,
  SOURCE_EXTENSIONS,
  UNMEASURED_FORMATS,
  WARN_LIMIT,
  classify,
  countLines,
  evaluate,
  isExcluded,
  isSourcePath,
  listSourceFiles,
  measure,
  reportFlag,
  reportWarnings,
  summarise,
} from './source-size.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

let failures = 0;
function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ========================================================================== */
console.log('\nA. What counts as a source file');
/* ========================================================================== */

assert('A1. every executable extension this repository uses is measured',
  ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].every((e) => SOURCE_EXTENSIONS.includes(e)),
  SOURCE_EXTENSIONS.join(', '));

/*
 * Pinned by NAME, not by count.
 *
 * A length assertion does not hold: coverage can be EXCHANGED rather than
 * narrowed. Removing `.scss` and adding anything else keeps the length at 14, and
 * A1, F5 and F6 stay green while a whole language quietly stops being scanned.
 * Adding an extension is still free; removing one has to be a deliberate edit
 * here.
 */
const PINNED_EXTENSIONS = [
  '.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx',
  '.css', '.scss', '.html', '.rules', '.svelte', '.vue',
];
{
  const missing = PINNED_EXTENSIONS.filter((e) => !SOURCE_EXTENSIONS.includes(e));
  assert('A2. every measured language stays measured, each pinned by name',
    missing.length === 0,
    `no longer scanned: ${missing.join(', ')} — coverage may be added, never exchanged`);
}

assert('A3. a source path is recognised by extension, not by directory',
  isSourcePath('anywhere/at/all/thing.jsx') && isSourcePath('anywhere/styles.css')
  && !isSourcePath('src/data.json'),
  'moving a file must not change whether it is measured');

assert('A4. only the documented artifacts are excluded',
  EXCLUDED.length === 1 && EXCLUDED[0].path === 'public/pdf.worker.min.mjs',
  EXCLUDED.map((e) => e.path).join(', '));

assert('A5. every exclusion carries a reason',
  EXCLUDED.every((e) => typeof e.reason === 'string' && e.reason.length > 40),
  'an exclusion without an argument is an allowlist entry');

/*
 * The roots are pinned, not merely iterated.
 *
 * Every other assertion about them derives from the list itself — D10 counts
 * `REQUIRED_ROOTS.length - 1`, E2 loops over it — so deleting `landing` from it
 * would remove that directory's blindness guard and leave the whole suite green.
 * A guard whose scope comes from the branch under test is not a guard. Adding a
 * root is free; removing one has to be a deliberate edit here.
 */
assert('A6b. the directories that must never go unscanned are pinned by name',
  ['src', 'functions', 'scripts', 'e2e', 'web', '.storybook']
    .every((root) => REQUIRED_ROOTS.includes(root))
  && REQUIRED_ROOTS.length === 6,
  REQUIRED_ROOTS.join(', '));

assert('A6. isExcluded matches the whole path, not a suffix',
  isExcluded('public/pdf.worker.min.mjs') && !isExcluded('src/public/pdf.worker.min.mjs'),
  'a copy elsewhere is a different file and is measured');

{
  /*
   * Every tracked format has an answer — measured, deliberately unmeasured, or
   * not source at all.
   *
   * A format in NO list — `.mdx` without its entry — lets a Storybook page grow
   * to any length while every assertion above stays satisfied by unrelated
   * files, unless "is this format covered" is asked, not only "are these
   * extensions still listed". That is the same shape as A6b, which exists
   * because deleting a required root would go unnoticed too.
   *
   * The inventory is the whole tree, not `REQUIRED_ROOTS`. Those roots answer
   * "has the scan stopped covering a directory", which is a different question;
   * the checker itself reads `git ls-files` over everything and measures
   * `eslint.config.js`, `index.html` and the rest, so its coverage claim is about
   * the whole tree. Borrowing the roots leaves `.gitleaks.toml` unclassified and
   * lets a 900-line `build.py` at the repository root pass both this and the size
   * scan (reproduced): a check must not take its scope from something narrower
   * than the claim it is making.
   *
   * Asserted against the real tracked tree rather than a fixture, because the
   * hazard is a format ARRIVING, and a fixture only ever contains what its author
   * thought of. The message names the format and a file, so the fix is either one
   * line in a list or a decision recorded beside it.
   */
  const tracked = execFileSync('git', ['ls-files', '-z'],
    { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
  const unclassified = new Map();
  for (const path of tracked) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    // `>= 0`, not `> 0`: a dotfile IS its own format. `.gcloudignore` has its dot
    // at index 0, and `dot > 0` reported it as "(no extension)" — which is a
    // second way for a format to be unclassifiable rather than unclassified.
    const dot = name.lastIndexOf('.');
    const extension = dot >= 0 ? name.slice(dot) : '(no extension)';
    if (ACCOUNTED_FORMATS.includes(extension)) continue;
    if (!unclassified.has(extension)) unclassified.set(extension, path);
  }
  assert('A7. no tracked format anywhere in the repository is unclassified',
    unclassified.size === 0,
    [...unclassified].map(([ext, path]) => `${ext} (e.g. ${path})`).join(', ')
      + ' — add it to SOURCE_EXTENSIONS, UNMEASURED_FORMATS or NOT_SOURCE_FORMATS');
  assert('A7b. and every non-source entry says why it is not source',
    NOT_SOURCE_FORMATS.every((entry) => entry.extension.startsWith('.')
      && typeof entry.reason === 'string' && entry.reason.length > 20),
    'an exclusion without a reason is the allowlist this campaign refuses');
  assert('A7c. the three lists do not overlap',
    new Set(ACCOUNTED_FORMATS).size === ACCOUNTED_FORMATS.length,
    'a format in two lists has two answers, and one of them is stale');
}

/* ========================================================================== */
console.log('\nB. Counting');
/* ========================================================================== */

assert('B1. counts physical lines the way wc -l does', countLines('a\nb\nc\n') === 3);
assert('B2. counts a final line with no newline', countLines('a\nb') === 2);
assert('B3. an empty file is zero', countLines('') === 0);
assert('B4. a single unterminated line is one', countLines('x') === 1);
assert('B5. blank lines count, because they are lines to scroll past',
  countLines('a\n\n\nb\n') === 4);

{
  // The metric must agree with the tool everybody reaches for.
  const sample = 'scripts/source-size.mjs';
  const viaWc = Number(execFileSync('wc', ['-l', sample], { cwd: repoRoot, encoding: 'utf8' })
    .trim().split(/\s+/)[0]);
  const viaChecker = countLines(readFileSync(resolve(repoRoot, sample), 'utf8'));
  assert('B6. and agrees with wc -l on a real file', viaWc === viaChecker,
    `wc says ${viaWc}, the checker says ${viaChecker}`);
}

/* ========================================================================== */
console.log('\nC. Classification');
/* ========================================================================== */

const cases = [
  ['src/features/x/Thing.jsx', 'runtime'],
  ['functions/ai/callables.js', 'runtime'],
  ['src/features/x/Thing.test.jsx', 'test'],
  ['functions/test/unit/a.test.js', 'test'],
  ['src/features/x/Thing.contract.test.jsx', 'test'],
  ['e2e/a11y.spec.cjs', 'test'],
  ['e2e/helpers/wizardHelpers.cjs', 'test'],
  ['scripts/test-ci-plan.mjs', 'test'],
  ['scripts/ci-plan/test-gate.mjs', 'test'],
  ['scripts/ci-plan.mjs', 'tooling'],
  ['scripts/ci-plan/latest-plan.mjs', 'tooling'],
  ['.storybook/main.js', 'tooling'],
  ['vite.config.js', 'tooling'],
];
for (const [path, expected] of cases) {
  assert(`C. ${path} is ${expected}`, classify(path) === expected, classify(path));
}

/* ========================================================================== */
console.log('\nD. The verdict');
/* ========================================================================== */

const file = (path, lines) => ({ path, lines, category: classify(path) });
/** A tree that satisfies the required-roots check, so D can test one thing at a time. */
const roots = REQUIRED_ROOTS.map((root, i) => file(`${root}/placeholder${i}.js`, 10));
const withRoots = (...extra) => [...roots, ...extra];

{
  const { ok } = evaluate(withRoots(file('src/a.js', HARD_LIMIT)));
  assert('D1. a file exactly at the limit passes', ok, `${HARD_LIMIT} lines is allowed`);
}
{
  const { ok, problems } = evaluate(withRoots(file('src/a.js', HARD_LIMIT + 1)));
  assert('D2. one line over fails', !ok && /over the 700-line maximum/.test(problems[0]), problems[0]);
}
{
  const { ok, warnings } = evaluate(withRoots(file('src/a.test.js', 5000), file('e2e/b.spec.cjs', 900)));
  assert('D3. a TEST file has no limit, and is not warned about either',
    ok && warnings.length === 0, JSON.stringify(warnings));
}
{
  const { ok } = evaluate(withRoots(file('scripts/a.mjs', HARD_LIMIT + 1)));
  assert('D4. TOOLING keeps the limit', !ok);
}
{
  const { ok, warnings } = evaluate(withRoots(file('src/a.js', WARN_LIMIT + 1), file('src/b.js', WARN_LIMIT)));
  assert('D5. past the warning line passes, and names the file',
    ok && warnings.length === 1 && /src\/a\.js is 501 lines, past the 500-line warning/.test(warnings[0]),
    JSON.stringify(warnings));
}
{
  const printed = (env) => {
    const lines = [];
    reportWarnings(['src/a.js is 501 lines'], { env, log: (line) => lines.push(line) });
    return lines.join('\n');
  };
  assert('D6. a warning is printed, and in CI also annotated on the pull request',
    printed({ GITHUB_ACTIONS: 'true' }).includes('::warning title=Source size::src/a.js is 501 lines')
      && printed({}).includes('warning: src/a.js is 501 lines') && !printed({}).includes('::warning'),
    printed({ GITHUB_ACTIONS: 'true' }));
}
{
  const files = [file('src/a.test.js', 900), file('e2e/b.spec.cjs', 600), file('src/c.js', 600)];
  const { test, runtime } = Object.fromEntries(summarise(files));
  assert('D7. the report counts and marks a long test against no limit',
    test.over === 0 && test.warn === 0 && runtime.warn === 1
      && reportFlag(files[0]) === ' ' && reportFlag(files[1]) === ' ' && reportFlag(files[2]) === '~',
    JSON.stringify({ test, runtime }));
}
{
  // Found while probing the guard: `git ls-files` names what the INDEX knows,
  // and the index can name a file the working tree does not have. Reading it
  // threw ENOENT and killed the run in a stack trace.
  const missing = { path: 'src/gone.js', lines: null, category: 'runtime' };
  const { ok, problems } = evaluate(withRoots(missing));
  assert('D9b. a tracked file that cannot be read fails, and does not crash',
    !ok && /could not be read/.test(problems.join(' ')), problems.join(' '));
}
{
  const { ok, problems } = evaluate([file('src/a.js', 10)]);
  assert('D10. a scan that stopped covering a required root fails',
    !ok && /stopped looking/.test(problems.join(' ')),
    `${problems.length} problem(s) for ${REQUIRED_ROOTS.length - 1} missing roots`);
}
{
  const { problems } = evaluate([file('src/a.js', 10)]);
  assert('D11. and names every root it lost, not just the first',
    problems.filter((p) => /stopped looking/.test(p)).length === REQUIRED_ROOTS.length - 1);
}

/* ========================================================================== */
console.log('\nE. Against the real repository');
/* ========================================================================== */

{
  const files = measure();
  assert('E1. the scan finds a substantial tree', files.length > 900, `${files.length} files`);

  for (const root of REQUIRED_ROOTS) {
    const found = files.filter((f) => f.path === root || f.path.startsWith(`${root}/`)).length;
    assert(`E2. ${root}/ is covered`, found > 0, `${found} files`);
  }

  const categories = new Set(files.map((f) => f.category));
  assert('E3. all three categories are represented',
    ['runtime', 'test', 'tooling'].every((c) => categories.has(c)), [...categories].join(', '));

  assert('E4. nothing gitignored slipped in',
    !files.some((f) => /^(dist|storybook-static|coverage)\//.test(f.path)
      || f.path.includes('node_modules/')),
    'build output is unreachable because the scan reads git ls-files');

  assert('E5. the excluded artifact really is excluded',
    !files.some((f) => f.path === 'public/pdf.worker.min.mjs'));

  const over = files.filter((f) => f.category !== 'test' && f.lines > HARD_LIMIT).map((f) => f.path);
  assert('E6. no runtime or tooling file is over the limit', over.length === 0, over.join(', '));

  // The rules file used to carry its own ceiling; it is measured like any other.
  assert('E7. the Firestore rules are measured like any other source file',
    files.some((f) => f.path === 'src/firestore.rules' && f.category === 'runtime' && Number.isInteger(f.lines)),
    'src/firestore.rules must appear in measure() output');
}

assert('F1. the warning line is 500 and the hard limit 700 (owner ruling, 2026-10-11)',
  WARN_LIMIT === 500 && HARD_LIMIT === 700);

{
  // Injected `run`, so this covers the filtering without a repository.
  const listed = listSourceFiles({
    run: () => ['src/a.jsx', 'src/b.json', 'public/pdf.worker.min.mjs', 'deep/nested/c.ts', ''],
  });
  assert('F2. filters to source, drops the excluded, keeps files wherever they live',
    JSON.stringify(listed) === JSON.stringify(['deep/nested/c.ts', 'src/a.jsx']),
    JSON.stringify(listed));

  /*
   * The list arrives NUL-delimited from git and stays an array. Re-encoded
   * through newline-delimited text, a tracked path containing a newline parses
   * as two paths — a fragment that gets filtered out, plus a second name that
   * can alias a small file — so the large file is never read and the run
   * passes. The name below is one path.
   */
  const withNewline = listSourceFiles({ run: () => ['src/ignored\nsrc/small.js', 'src/small.js'] });
  assert('F3. a path containing a newline is one path, not two',
    withNewline.length === 2 && withNewline.includes('src/ignored\nsrc/small.js'),
    JSON.stringify(withNewline));

  // A leading or trailing space is a legal part of a filename, so nothing is
  // trimmed either — trimming would look up the wrong file and report it missing.
  const spaced = listSourceFiles({ run: () => [' src/spaced.js'] });
  assert('F4. and a name with a leading space is not silently rewritten',
    JSON.stringify(spaced) === JSON.stringify([' src/spaced.js']), JSON.stringify(spaced));
}

assert('F5. the languages this repository writes by hand are all measured',
  ['.css', '.html', '.rules'].every((e) => SOURCE_EXTENSIONS.includes(e)),
  'a 3447-line stylesheet and a 693-line rules file were invisible until 2026-08-27');

assert('F6. and every format left out says why it is not source',
  UNMEASURED_FORMATS.length > 0
  && UNMEASURED_FORMATS.every((f) => f.extension.startsWith('.') && f.reason.length > 40)
  && UNMEASURED_FORMATS.every((f) => !SOURCE_EXTENSIONS.includes(f.extension)),
  'what a coverage claim does NOT look at is the half that goes stale silently');

{
  const checker = readFileSync(resolve(here, 'source-size.mjs'), 'utf8');
  const scope = readFileSync(resolve(here, 'source-size-scope.mjs'), 'utf8');
  assert('F7. the scan reads git, so moving a file cannot hide it',
    /ls-files/.test(checker) && !/readdirSync/.test(checker),
    'a directory walk can be steered by a path pattern; the tracked set cannot');
  /*
   * Tests are the one category without a limit. Anything else exempt would be
   * an allowlist, and the checker carries none: no backlog file, no per-file
   * ceiling, so there is nothing a branch could edit to let itself through.
   */
  assert('F8. nothing but a test is exempt, and no list can make it so',
    !/backlog/i.test(checker) && !/EXCEPTIONS|maxLines/.test(checker + scope),
    'an exemption list in the branch under test is an allowlist');
}

console.log(failures === 0
  ? '\nAll source-size checks passed.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
