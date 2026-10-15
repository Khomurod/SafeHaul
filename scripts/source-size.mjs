#!/usr/bin/env node
/**
 * How big is every handwritten source file in this repository, and which ones
 * have outgrown a single responsibility?
 *
 * ## Why a checker rather than a review habit
 *
 * File length is not decided; it accumulates, one reasonable-looking addition
 * at a time, wherever nothing says no.
 *
 * ## The standard
 *
 * - **500 lines** is the warning: the check names the file (a GitHub warning in
 *   CI), and it is asked to justify its shape in review. A cohesive module past
 *   it is fine.
 * - **700 physical lines** is the hard maximum for runtime code and tooling.
 * - **Tests have no limit**: a long suite is a list of cases.
 *
 * ## What counts
 *
 * Physical lines, as `wc -l` counts them. Deliberately not "lines of code":
 * stripping comments would reward deleting the explanations this repository
 * relies on, and counting statements would reward putting three on one line.
 * The metric is meant to measure *how much there is to read*.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
/*
 * Imported AND re-exported: the run below uses these, and the tests import them
 * from here. A split must not move a published name, so the entry keeps its whole
 * surface even though the declaration lives in `source-size-scope.mjs`.
 */
import {
  ACCOUNTED_FORMATS, classify, EXCLUDED,
  HARD_LIMIT, isExcluded, isSourcePath, NOT_SOURCE_FORMATS, REQUIRED_ROOTS,
  SOURCE_EXTENSIONS, UNMEASURED_FORMATS, WARN_LIMIT,
} from './source-size-scope.mjs';

export {
  ACCOUNTED_FORMATS, classify, EXCLUDED,
  HARD_LIMIT, isExcluded, isSourcePath, NOT_SOURCE_FORMATS, REQUIRED_ROOTS,
  SOURCE_EXTENSIONS, UNMEASURED_FORMATS, WARN_LIMIT,
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
 * The `-z` is the whole point, so nothing here turns the separators into
 * newlines. A tracked path may contain a newline, and one called
 * `src/ignored<LF>src/small.js` split on newlines parses as two paths — a
 * discarded fragment plus a second copy of a small file — so a 600-line file is
 * never read and the run passes. No path is trimmed either, since a leading or
 * trailing space is a legal part of a name.
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
 * Compare the tree against the standard.
 *
 * Pure, so `scripts/test-source-size.mjs` can drive every verdict without a
 * repository to point it at. `problems` fail the run; `warnings` name the files
 * past the warning line, which the run reports and passes.
 */
export function evaluate(files) {
  const problems = [];
  const warnings = [];

  for (const file of files) {
    if (file.lines === null) {
      problems.push(`${file.path} is tracked but could not be read. The index and the working `
        + 'tree disagree, so no size for it can be trusted.');
      continue;
    }
    if (file.category === 'test') continue;
    if (file.lines > HARD_LIMIT) {
      problems.push(`${file.path} is ${file.lines} lines, over the ${HARD_LIMIT}-line maximum. `
        + 'Split it by responsibility.');
    } else if (file.lines > WARN_LIMIT) {
      warnings.push(`${file.path} is ${file.lines} lines, past the ${WARN_LIMIT}-line warning `
        + `(the maximum is ${HARD_LIMIT}).`);
    }
  }

  const missingRoots = REQUIRED_ROOTS.filter(
    (root) => !files.some((file) => file.path === root || file.path.startsWith(`${root}/`)),
  );
  for (const root of missingRoots) {
    problems.push(`no source files were found under ${root}/. The scan has stopped looking `
      + 'somewhere it matters, which makes every number below meaningless.');
  }

  return { ok: problems.length === 0, problems, warnings };
}

/**
 * A file's mark in the report: `!` past the maximum, `~` past the warning, `?`
 * unreadable. A test has no limit, so a long one is not marked.
 */
export function reportFlag(file) {
  if (file.lines === null) return '?';
  if (file.category === 'test') return ' ';
  return file.lines > HARD_LIMIT ? '!' : file.lines > WARN_LIMIT ? '~' : ' ';
}

export function summarise(files) {
  const byCategory = new Map();
  for (const file of files) {
    const bucket = byCategory.get(file.category) || { count: 0, lines: 0, over: 0, warn: 0 };
    bucket.count += 1;
    bucket.lines += file.lines;
    // A test has no limit, so it is never counted as past one.
    if (file.category !== 'test') {
      if (file.lines > HARD_LIMIT) bucket.over += 1;
      else if (file.lines > WARN_LIMIT) bucket.warn += 1;
    }
    byCategory.set(file.category, bucket);
  }
  return byCategory;
}

/** Print each warning; in CI also as a workflow annotation, so it shows on the pull request. */
export function reportWarnings(warnings, { env = process.env, log = console.log } = {}) {
  for (const warning of warnings) {
    log(`\nwarning: ${warning}`);
    if (env.GITHUB_ACTIONS === 'true') log(`::warning title=Source size::${warning}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const top = Number(args.find((a) => a.startsWith('--top='))?.split('=')[1] || 30);

  const files = measure();
  const verdict = evaluate(files);
  const byCategory = summarise(files);

  console.log(`Scanned ${files.length} handwritten source files `
    + `(${SOURCE_EXTENSIONS.join(', ')}), excluding ${EXCLUDED.length} vendored artifact(s).\n`);

  console.log(`| category | files | lines | >${HARD_LIMIT} | ${WARN_LIMIT + 1}-${HARD_LIMIT} |`);
  console.log('| --- | ---: | ---: | ---: | ---: |');
  for (const [category, b] of [...byCategory].sort((a, z) => z[1].lines - a[1].lines)) {
    const limited = category !== 'test';
    console.log(`| ${category} | ${b.count} | ${b.lines} | ${limited ? b.over : '—'} | ${limited ? b.warn : '—'} |`);
  }

  console.log(`\nLargest ${top}:\n`);
  for (const file of files.slice(0, top)) {
    const flag = reportFlag(file);
    const size = file.lines === null ? '  ???' : String(file.lines).padStart(5);
    console.log(`  ${flag} ${size}  ${file.category.padEnd(7)}  ${file.path}`);
  }

  reportWarnings(verdict.warnings);

  if (!verdict.ok) {
    console.error(`\nsource-size REFUSED:\n${verdict.problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`\nsource-size OK (${verdict.warnings.length} warning(s)).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`source-size REFUSED\n\n${error?.stack || error}`);
    process.exit(1);
  }
}
