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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKLOG_PATH,
  EXCLUDED,
  HARD_LIMIT,
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

assert('A2. and the list is not quietly narrowed',
  SOURCE_EXTENSIONS.length >= 14,
  `${SOURCE_EXTENSIONS.length} extensions — adding one is fine, dropping one is how coverage `
  + 'disappears, and the count only ever going up is what makes that visible');

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

assert('A6. isExcluded matches the whole path, not a suffix',
  isExcluded('public/pdf.worker.min.mjs') && !isExcluded('src/public/pdf.worker.min.mjs'),
  'a copy elsewhere is a different file and is measured');

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
  ['scripts/ci-plan.mjs', 'tooling'],
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
  const { ok } = evaluate(withRoots(file('src/a.js', HARD_LIMIT)), {});
  assert('D1. a file exactly at the limit passes', ok, `${HARD_LIMIT} lines is allowed`);
}
{
  const { ok, problems } = evaluate(withRoots(file('src/a.js', HARD_LIMIT + 1)), {});
  assert('D2. one line over fails', !ok && /over the 500-line maximum/.test(problems[0]), problems[0]);
}
{
  const { ok } = evaluate(withRoots(file('src/a.test.js', HARD_LIMIT + 1)), {});
  assert('D3. and a TEST file gets no exemption', !ok);
}
{
  const { ok } = evaluate(withRoots(file('scripts/a.mjs', HARD_LIMIT + 1)), {});
  assert('D4. nor does TOOLING', !ok);
}
{
  const { ok } = evaluate(withRoots(file('src/big.js', 900)), { 'src/big.js': 900 });
  assert('D5. a backlogged file at its recorded size passes', ok);
}
{
  const { ok, problems } = evaluate(withRoots(file('src/big.js', 901)), { 'src/big.js': 900 });
  assert('D6. a backlogged file that GREW fails', !ok && /may not grow/.test(problems.join(' ')),
    problems.join(' '));
}
{
  const { ok, problems } = evaluate(withRoots(file('src/big.js', 400)), { 'src/big.js': 900 });
  assert('D7. one that came back under the limit must leave the backlog',
    !ok && /only shrinks/.test(problems.join(' ')), problems.join(' '));
}
{
  const { ok, problems } = evaluate(withRoots(), { 'src/gone.js': 900 });
  assert('D8. a backlog entry for a file that no longer exists fails',
    !ok && /does not carry its exemption/.test(problems.join(' ')), problems.join(' '));
}
{
  // The rename bypass, stated as a test: the entry is keyed by path, so moving
  // the file leaves the entry stale AND the file unbacklogged — two failures,
  // never a silent pass.
  const moved = evaluate(withRoots(file('src/renamed.js', 900)), { 'src/big.js': 900 });
  assert('D9. renaming a backlogged file does not carry the exemption with it',
    !moved.ok && moved.problems.length === 2, JSON.stringify(moved.problems));
}
{
  // Found while probing the guard: `git ls-files` names what the INDEX knows,
  // and the index can name a file the working tree does not have. Reading it
  // threw ENOENT and killed the run in a stack trace.
  const missing = { path: 'src/gone.js', lines: null, category: 'runtime' };
  const { ok, problems } = evaluate(withRoots(missing), {});
  assert('D9b. a tracked file that cannot be read fails, and does not crash',
    !ok && /could not be read/.test(problems.join(' ')), problems.join(' '));
}
{
  const { ok, problems } = evaluate([file('src/a.js', 10)], {});
  assert('D10. a scan that stopped covering a required root fails',
    !ok && /stopped looking/.test(problems.join(' ')),
    `${problems.length} problem(s) for ${REQUIRED_ROOTS.length - 1} missing roots`);
}
{
  const { problems } = evaluate([file('src/a.js', 10)], {});
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

  const backlogFile = resolve(repoRoot, BACKLOG_PATH);
  const backlog = existsSync(backlogFile)
    ? JSON.parse(readFileSync(backlogFile, 'utf8')).files || {}
    : {};
  const over = files.filter((f) => f.lines > HARD_LIMIT).map((f) => f.path);
  const unrecorded = over.filter((p) => !(p in backlog));
  assert('E6. every file over the limit is either fixed or recorded',
    unrecorded.length === 0, unrecorded.join(', '));

  assert('E7. the backlog describes why it exists',
    !existsSync(backlogFile) || typeof JSON.parse(readFileSync(backlogFile, 'utf8')).$comment === 'object'
      || typeof JSON.parse(readFileSync(backlogFile, 'utf8')).$comment === 'string',
    'a bare list of paths is an allowlist; this one has to say it is a campaign');
}

assert('F1. the warning threshold sits below the hard limit',
  WARN_LIMIT < HARD_LIMIT && WARN_LIMIT === 400 && HARD_LIMIT === 500);

{
  // Injected `run`, so this covers the filtering without a repository.
  const listed = listSourceFiles({
    run: () => ['src/a.jsx', 'src/b.json', 'public/pdf.worker.min.mjs', 'deep/nested/c.ts', ''],
  });
  assert('F2. filters to source, drops the excluded, keeps files wherever they live',
    JSON.stringify(listed) === JSON.stringify(['deep/nested/c.ts', 'src/a.jsx']),
    JSON.stringify(listed));

  /*
   * The list arrives NUL-delimited from git and stays an array. It used to be
   * re-encoded through newline-delimited text, and review on 2026-08-27 found
   * what that costs: a tracked path may contain a newline, and one of those
   * parses as two paths — a fragment that gets filtered out, plus a second name
   * that can alias a small file — so the large file is never read and the run
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

/* ========================================================================== */
console.log('\nG. The standard is enforced in CI, and cannot go blind');
/* ========================================================================== */
{
    const workflow = readFileSync(resolvePath(repoRoot, '.github/workflows/main.yml'), 'utf8');
    const pkg = JSON.parse(readFileSync(resolvePath(repoRoot, 'package.json'), 'utf8'));
    const checker = readFileSync(resolvePath(here, 'source-size.mjs'), 'utf8');

    /*
     * An audit on 2026-08-26 counted 68 handwritten files over 500 physical
     * lines, none of it decided — it accumulated because nothing ever said no.
     * These pin the saying-no.
     */
    assert('G1. the size check runs in CI',
        /npm run check:source-size/.test(workflow),
        'a standard CI does not run is a suggestion');
    assert('G2. and so do the guard\'s own tests',
        /npm run test:source-size/.test(workflow),
        'a checker that has stopped looking reports a shorter list, which reads as progress');
    /*
     * Both steps live in `callable-contract`, which `scripts/ci-plan.mjs` lists
     * in ALWAYS_REQUIRED_JOBS — so no tree-hash proof can skip them. A size
     * standard CI is allowed to skip is not a standard.
     */
    const afterHeading = workflow.slice(workflow.indexOf('\n  callable-contract:') + 1);
    const nextJob = afterHeading.search(/\n {2}[a-z][a-z0-9-]*:\n/);
    const jobBody = nextJob === -1 ? afterHeading : afterHeading.slice(0, nextJob);
    const ciPlan = readFileSync(resolvePath(repoRoot, 'scripts/ci-plan.mjs'), 'utf8');
    assert('G3. both live in a job that can never be skipped',
        /Check source sizes/.test(jobBody)
        && /Verify the source-size guard/.test(jobBody)
        && /ALWAYS_REQUIRED_JOBS[^\n]*'callable-contract'/.test(ciPlan),
        'a tree-hash proof must not be able to skip the size gate')
    assert('G4. both are real npm scripts',
        typeof pkg.scripts['check:source-size'] === 'string'
        && typeof pkg.scripts['test:source-size'] === 'string');
    assert('G5. the limits are the agreed ones',
        /HARD_LIMIT = 500/.test(checker) && /WARN_LIMIT = 400/.test(checker),
        'changing a limit is a decision, not a refactor');
    assert('G6. the scan reads git, so moving a file cannot hide it',
        /ls-files/.test(checker) && !/readdirSync/.test(checker),
        'a directory walk can be steered by a path pattern; the tracked set cannot');
    assert('G7. the backlog can only shrink',
        /only shrinks/.test(checker) && /may not grow/.test(checker),
        'an exemption list that can grow is an allowlist');

    /*
     * And the rule above is enforced against a copy the branch cannot edit, or it
     * is not enforced at all. `--require-baseline` is the difference; a flag CI
     * does not pass is decorative, which is the same shape of bug as a scanner
     * flag nobody checks for.
     */
    assert('G8. CI proves the backlog did not grow, rather than trusting it',
        /check:source-size -- --require-baseline/.test(jobBody),
        'without the flag the guard skips the comparison when it cannot find a base');
    assert('G9. and that job has the history the proof needs',
        /- uses: actions\/checkout@v5\n\s+with:\n\s+fetch-depth: 0/.test(jobBody),
        'a depth-1 checkout has no previous backlog to compare against, so the '
        + 'guard would refuse every run');
    assert('G10. the base comes from the event, not from a guess',
        /SOURCE_SIZE_BASE: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before/
            .test(jobBody),
        'a pull request compares against its own base commit; a push against the tip it replaced');
}

console.log(failures === 0
  ? '\nAll source-size checks passed.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
