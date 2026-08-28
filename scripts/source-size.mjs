#!/usr/bin/env node
/**
 * How big is every handwritten source file in this repository, and which ones
 * have outgrown a single responsibility?
 *
 * ## Why a checker rather than a review habit
 *
 * An audit on 2026-08-26 counted physical lines across the whole tree for the
 * first time and found **68 files over 500 lines** — a 2203-line test, a
 * 1476-line React component that owns the public application, a 1188-line
 * registry, four tooling scripts over 1000. None of that was decided; it
 * accumulated, one reasonable-looking addition at a time, because nothing ever
 * said no.
 *
 * ## The standard
 *
 * - **400 lines** is the review threshold: a file this size is asked to justify
 *   its shape, not split on sight. A cohesive 420-line module is fine.
 * - **500 physical lines** is the hard maximum for handwritten code, and it
 *   applies to tests and tooling exactly as it does to runtime code. A test file
 *   nobody can read is a test file nobody maintains.
 *
 * ## What counts
 *
 * Physical lines, as `wc -l` counts them. Deliberately not "lines of code":
 * stripping comments would reward deleting the explanations this repository
 * relies on, and counting statements would reward putting three on one line.
 * The metric is meant to measure *how much there is to read*.
 *
 * ## The backlog is a campaign, not an allowlist
 *
 * `.github/source-size-backlog.json` records the files that were already over
 * the limit when the standard arrived, with the line count each had. It is not
 * permission to stay large:
 *
 * - a file NOT in it may never exceed the limit — that is the gate;
 * - a file in it may never GROW past its recorded count;
 * - a file in it that has come back under the limit must be REMOVED from it,
 *   and this fails until it is, so the backlog can only shrink;
 * - an entry for a file that no longer exists fails too, so a rename cannot
 *   quietly carry an exemption with it.
 *
 * When the last entry goes, the file goes, and `--no-backlog` becomes the
 * permanent state.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBacklogDirection } from './source-size-baseline.mjs';
import { resolveValidatedBaseline } from './source-size-validated.mjs';
import { backlogShapeProblems } from './source-size-direction.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
/*
 * Imported AND re-exported: the run below uses these, and the tests and the
 * baseline modules import them from here. A split must not move a published name,
 * so the entry keeps its whole surface even though the declaration now lives in
 * `source-size-scope.mjs`.
 */
import {
  ACCOUNTED_FORMATS, BACKLOG_PATH, classify, EXCLUDED, HARD_LIMIT, isExcluded,
  isSourcePath, NOT_SOURCE_FORMATS, REQUIRED_ROOTS, SOURCE_EXTENSIONS,
  UNMEASURED_FORMATS, WARN_LIMIT,
} from './source-size-scope.mjs';

export {
  ACCOUNTED_FORMATS, BACKLOG_PATH, classify, EXCLUDED, HARD_LIMIT, isExcluded,
  isSourcePath, NOT_SOURCE_FORMATS, REQUIRED_ROOTS, SOURCE_EXTENSIONS,
  UNMEASURED_FORMATS, WARN_LIMIT,
};


/**
 * Every tracked source file, from git rather than a directory walk.
 *
 * Git is what makes this non-bypassable by moving a file: `ls-files` reports
 * everything tracked wherever it lives, so a 900-line component does not escape
 * by being renamed or shuffled into a new folder. It also means gitignored build
 * output is structurally unreachable rather than excluded by a pattern somebody
 * could widen.
 */
export function listSourceFiles({ cwd = repoRoot, run = defaultGit } = {}) {
  return run(cwd)
    .filter(Boolean)
    .filter(isSourcePath)
    .filter((path) => !isExcluded(path))
    .sort();
}

/**
 * Every tracked path, as the NUL-delimited list git actually produced.
 *
 * The `-z` is the whole point, and it used to be thrown away: the separators were
 * turned into newlines and the result split on newlines again. Review on
 * 2026-08-27 found what that costs. A tracked path may contain a newline, and one
 * called `src/ignored<LF>src/small.js` then parses as two paths — a discarded
 * fragment plus a second copy of a small file — so a 600-line file is never read
 * and the run passes. Nothing splits on newlines here now, and no path is
 * trimmed either, since a leading or trailing space is a legal part of a name.
 */
function defaultGit(cwd) {
  return execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0');
}

/** Physical lines: what `wc -l` counts, plus a trailing unterminated line. */
export function countLines(contents) {
  if (contents === '') return 0;
  const newlines = (contents.match(/\n/g) || []).length;
  return contents.endsWith('\n') ? newlines : newlines + 1;
}

export function measure({ cwd = repoRoot, run = defaultGit, read } = {}) {
  const readFile = read || ((path) => readFileSync(resolve(cwd, path), 'utf8'));
  return listSourceFiles({ cwd, run })
    .map((path) => {
      /*
       * Tracked, but not on disk.
       *
       * `git ls-files` reports what the index knows, and the index can name a
       * file the working tree does not have — a staged deletion, an
       * intent-to-add, an interrupted checkout. Reading it threw an ENOENT and
       * the whole run died in a stack trace, which found this while probing the
       * guard's own failure modes. A size checker that crashes tells you
       * nothing; `lines: null` carries it to `evaluate`, which says what is
       * wrong and fails.
       */
      let contents = null;
      try {
        contents = readFile(path);
      } catch {
        return { path, lines: null, category: classify(path) };
      }
      return { path, lines: countLines(contents), category: classify(path) };
    })
    .sort((a, b) => (b.lines ?? 0) - (a.lines ?? 0) || a.path.localeCompare(b.path));
}

/**
 * Compare the tree against the standard and the backlog.
 *
 * Pure, so `scripts/test-source-size.mjs` can drive every verdict without a
 * repository to point it at.
 */
export function evaluate(files, backlog = {}) {
  /*
   * A recorded count that is not a number makes every comparison below FALSE
   * rather than failing, so the shape is checked before anything is compared. See
   * `backlogShapeProblems`.
   */
  const problems = backlogShapeProblems(backlog, BACKLOG_PATH);
  if (problems.length > 0) return { ok: false, problems };
  const measured = new Map(files.map((file) => [file.path, file.lines]));

  for (const file of files) {
    if (file.lines === null) {
      problems.push(`${file.path} is tracked but could not be read. The index and the working `
        + 'tree disagree, so no size for it can be trusted.');
      continue;
    }
    const recorded = backlog[file.path];
    if (recorded === undefined) {
      if (file.lines > HARD_LIMIT) {
        problems.push(`${file.path} is ${file.lines} lines, over the ${HARD_LIMIT}-line maximum. `
          + 'Split it by responsibility.');
      }
      continue;
    }
    if (file.lines > recorded) {
      problems.push(`${file.path} is ${file.lines} lines, up from the ${recorded} recorded in `
        + `${BACKLOG_PATH}. A file in the backlog may not grow.`);
    }
    if (file.lines <= HARD_LIMIT) {
      problems.push(`${file.path} is ${file.lines} lines and no longer needs a backlog entry. `
        + `Remove it from ${BACKLOG_PATH} — the backlog only shrinks.`);
    }
  }

  for (const path of Object.keys(backlog)) {
    if (!measured.has(path)) {
      problems.push(`${BACKLOG_PATH} lists ${path}, which is not a scanned source file. `
        + 'A renamed or deleted file does not carry its exemption with it.');
    }
  }

  const missingRoots = REQUIRED_ROOTS.filter(
    (root) => !files.some((file) => file.path === root || file.path.startsWith(`${root}/`)),
  );
  for (const root of missingRoots) {
    problems.push(`no source files were found under ${root}/. The scan has stopped looking `
      + 'somewhere it matters, which makes every number below meaningless.');
  }

  return { ok: problems.length === 0, problems };
}

export function summarise(files) {
  const byCategory = new Map();
  for (const file of files) {
    const bucket = byCategory.get(file.category) || { count: 0, lines: 0, over: 0, warn: 0 };
    bucket.count += 1;
    bucket.lines += file.lines;
    if (file.lines > HARD_LIMIT) bucket.over += 1;
    else if (file.lines > WARN_LIMIT) bucket.warn += 1;
    byCategory.set(file.category, bucket);
  }
  return byCategory;
}

async function main() {
  const args = process.argv.slice(2);
  const top = Number(args.find((a) => a.startsWith('--top='))?.split('=')[1] || 30);
  const useBacklog = !args.includes('--no-backlog');
  /*
   * CI passes this, and it is what makes the backlog a record rather than an
   * allowlist: the three rules in `evaluate` are enforced against the backlog IN
   * THE BRANCH UNDER TEST, which that branch may edit. `--require-baseline`
   * refuses unless the previous version can be read out of git and shown not to
   * have grown. See scripts/source-size-baseline.mjs.
   */
  const requireBaseline = args.includes('--require-baseline');

  const files = measure();
  const backlogFile = resolve(repoRoot, BACKLOG_PATH);
  const backlog = useBacklog && existsSync(backlogFile)
    ? JSON.parse(readFileSync(backlogFile, 'utf8')).files || {}
    : {};

  const verdict = evaluate(files, backlog);
  const byCategory = summarise(files);

  const headSha = execFileSync('git', ['rev-parse', 'HEAD^{commit}'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const {
    lastValidatedBase, overrideValidated, automaticLookupComplete, error: lookupError,
  } = useBacklog
    ? await resolveValidatedBaseline({ headSha, cwd: repoRoot, log: console.log })
    : { lastValidatedBase: () => null, overrideValidated: () => false, error: null };

  const direction = useBacklog
    ? checkBacklogDirection({
      current: backlog,
      measured: files,
      countLines,
      path: BACKLOG_PATH,
      requireBaseline,
      lastValidatedBase,
      overrideValidated,
      automaticLookupComplete,
    })
    : { problems: [], describe: 'backlog ignored (--no-backlog)' };

  console.log(`Scanned ${files.length} handwritten source files `
    + `(${SOURCE_EXTENSIONS.join(', ')}), excluding ${EXCLUDED.length} vendored artifact(s).\n`);

  console.log('| category | files | lines | >500 | 401-500 |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  for (const [category, b] of [...byCategory].sort((a, z) => z[1].lines - a[1].lines)) {
    console.log(`| ${category} | ${b.count} | ${b.lines} | ${b.over} | ${b.warn} |`);
  }

  console.log(`\nLargest ${top}:\n`);
  for (const file of files.slice(0, top)) {
    const flag = file.lines === null ? '?' : file.lines > HARD_LIMIT ? '!' : file.lines > WARN_LIMIT ? '~' : ' ';
    const size = file.lines === null ? '  ???' : String(file.lines).padStart(5);
    console.log(`  ${flag} ${size}  ${file.category.padEnd(7)}  ${file.path}`);
  }

  const remaining = files.filter((f) => f.lines !== null && f.lines > HARD_LIMIT).length;
  console.log(`\n${remaining} file(s) over ${HARD_LIMIT} lines; `
    + `${Object.keys(backlog).length} recorded in the backlog.`);
  console.log(`backlog    : ${direction.describe}`);

  const problems = [...verdict.problems, ...direction.problems];
  if (problems.length > 0 && lookupError) {
    // "Nothing came back validated" and "the lookup could not run" fail the same
    // way and need very different fixes, so the refusal says which it was.
    problems.push(`the baseline lookup could not complete: ${lookupError}. That is why nothing `
      + 'came back validated — it is not evidence that nothing is.');
  }
  if (problems.length > 0) {
    console.error(`\nsource-size REFUSED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\nsource-size OK.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`source-size REFUSED\n\n${error?.stack || error}`);
    process.exit(1);
  });
}
